import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Données officielles des sénateurs — ODSEN (open data du Sénat).
// Remplit des champs précis et fiables (naissance, profession, groupe, commission…) pour
// TOUS les sénateurs en fonction, y compris ceux absents de Wikipédia. Correspondance par
// nom normalisé (vérifiée : 348/348).
const CSV_URL = "https://data.senat.fr/data/senateurs/ODSEN_GENERAL.csv";

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, " ").trim();

// Parseur CSV minimal gérant les champs entre guillemets (professions avec virgules).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw || raw.trimStart().startsWith("%")) continue;   // lignes de commentaire SQL
    const cells: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '"') { if (q && raw[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === "," && !q) { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

const cleanDate = (s: string) => {
  const m = (s || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

export async function syncSenatorOdsen() {
  console.log("--- SYNC ODSEN (données officielles sénateurs) ---");
  const res = await fetch(CSV_URL, { headers: { "User-Agent": "LaPolitiqueBot/1.0" }, signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`ODSEN HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const text = new TextDecoder("latin1").decode(buf);   // le fichier est en latin-1
  const rows = parseCsv(text);
  const hdr = rows[0];
  const H = (name: string) => hdr.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
  const iMat = H("Matricule"), iNom = H("Nom usuel"), iPre = H("nom usuel"), iEtat = H("tat"),
        iNai = H("Date naissance"), iGrp = H("Groupe politique"), iCom = H("Commission permanente"),
        iCirc = H("Circonscription"), iMail = H("lectronique"), iCsp = H("Cat"), iProf = H("Description de la profession");
  // Prénom = colonne juste après "Nom usuel".
  const iPrenom = iNom + 1;

  // Index des lignes ACTIF par nom normalisé (nom + prénom, et prénom + nom).
  const byName = new Map<string, string[]>();
  for (const r of rows.slice(1)) {
    if ((r[iEtat] || "").toUpperCase() !== "ACTIF") continue;
    const nom = r[iNom] || "", pre = r[iPrenom] || "";
    byName.set(norm(`${nom} ${pre}`), r);
    byName.set(norm(`${pre} ${nom}`), r);
  }
  console.log(`> ODSEN : ${byName.size / 2 | 0} sénateurs actifs.`);

  const { data: senators, error } = await supabase.from("senators").select("id, first_name, last_name");
  if (error) throw error;

  let ok = 0, miss = 0;
  for (const s of senators || []) {
    const r = byName.get(norm(`${s.last_name} ${s.first_name}`)) || byName.get(norm(`${s.first_name} ${s.last_name}`));
    if (!r) { miss++; console.warn(`  ! non trouvé dans ODSEN : ${s.first_name} ${s.last_name}`); continue; }
    const payload = {
      senate_matricule: r[iMat] || null,
      birth_date: cleanDate(r[iNai]),
      profession: (r[iProf] || "").trim() || null,
      csp: (r[iCsp] || "").trim() || null,
      senate_group: (r[iGrp] || "").trim() || null,
      committee: (r[iCom] || "").trim() || null,
      email: (r[iMail] || "").trim() || null,
    };
    const { error: upErr } = await supabase.from("senators").update(payload).eq("id", s.id);
    if (upErr) console.warn(`  ! update ${s.last_name}:`, upErr.message);
    else ok++;
  }
  console.log(`--- TERMINE. ${ok} sénateurs renseignés, ${miss} non trouvés. ---`);
  return ok;
}

if (process.argv[1] && process.argv[1].endsWith("sync-senator-odsen.ts")) {
  syncSenatorOdsen().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
