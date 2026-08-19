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

  // Index des lignes ACTIF par nom normalisé (nom + prénom, et prénom + nom) + liste dédup par matricule.
  const byName = new Map<string, string[]>();
  const activeByMat = new Map<string, string[]>();
  for (const r of rows.slice(1)) {
    if ((r[iEtat] || "").toUpperCase() !== "ACTIF") continue;
    const nom = r[iNom] || "", pre = r[iPrenom] || "";
    byName.set(norm(`${nom} ${pre}`), r);
    byName.set(norm(`${pre} ${nom}`), r);
    if (r[iMat]) activeByMat.set(r[iMat], r);
  }
  console.log(`> ODSEN : ${activeByMat.size} sénateurs actifs.`);

  const { data: senators, error } = await supabase.from("senators").select("id, first_name, last_name, photo_url");
  if (error) throw error;

  // Photo officielle senat.fr : {nom}_{prenom}{matricule}[_carre].jpg — on garde celle qui existe.
  const fileNorm = (str: string) => (str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
  const findPhoto = async (nom: string, pre: string, mat: string): Promise<string | null> => {
    if (!mat) return null;
    const base = `https://www.senat.fr/senimg/${fileNorm(nom)}_${fileNorm(pre)}${mat.toLowerCase()}`;
    for (const cand of [`${base}_carre.jpg`, `${base}.jpg`]) {
      try { const r = await fetch(cand, { signal: AbortSignal.timeout(12000) }); if (r.ok && (r.headers.get("content-type") || "").includes("image")) return cand; } catch { /* ignore */ }
    }
    return null;
  };

  let ok = 0, miss = 0, photos = 0;
  const sitting: string[] = [], gone: string[] = [];   // ids en fonction / sortis
  for (const s of senators || []) {
    const r = byName.get(norm(`${s.last_name} ${s.first_name}`)) || byName.get(norm(`${s.first_name} ${s.last_name}`));
    if (!r) { miss++; gone.push(s.id); console.warn(`  ! non trouvé dans ODSEN (sorti ?) : ${s.first_name} ${s.last_name}`); continue; }
    sitting.push(s.id);
    const payload: Record<string, any> = {
      senate_matricule: r[iMat] || null,
      birth_date: cleanDate(r[iNai]),
      profession: (r[iProf] || "").trim() || null,
      csp: (r[iCsp] || "").trim() || null,
      senate_group: (r[iGrp] || "").trim() || null,
      committee: (r[iCom] || "").trim() || null,
      email: (r[iMail] || "").trim() || null,
    };
    // Rattrapage photo : sénateur sans photo → on tente senat.fr (utile pour les nouveaux entrants
    // dont la photo est mise en ligne après leur arrivée, ex. Anne Camerac).
    if (!s.photo_url) { const p = await findPhoto(r[iNom] || "", r[iPrenom] || "", r[iMat] || ""); if (p) { payload.photo_url = p; photos++; } }
    const { error: upErr } = await supabase.from("senators").update(payload).eq("id", s.id);
    if (upErr) console.warn(`  ! update ${s.last_name}:`, upErr.message);
    else ok++;
  }
  // Statut « en fonction » : ACTIF dans ODSEN = en fonction ; absent = sorti (décès, démission,
  // remplacement par le suppléant…). Tolérant si la colonne `sitting` n'existe pas encore.
  const setSitting = async (ids: string[], value: boolean) => {
    if (!ids.length) return null;
    for (let i = 0; i < ids.length; i += 200) {
      const { error: e } = await supabase.from("senators").update({ sitting: value }).in("id", ids.slice(i, i + 200));
      if (e) return e;
    }
    return null;
  };
  const e1 = await setSitting(sitting, true);
  if (e1 && /sitting|column .* does not exist/i.test(e1.message)) {
    console.warn("  ! colonne senators.sitting absente — appliquer la migration pour activer la détection des départs.");
  } else {
    await setSitting(gone, false);
    console.log(`> Statut mis à jour : ${sitting.length} en fonction, ${gone.length} sorti(s).`);
  }

  // Insère les sénateurs ACTIF d'ODSEN absents de notre base (remplaçants des sortis).
  const ourNames = new Set<string>();
  for (const s of senators || []) { ourNames.add(norm(`${s.last_name} ${s.first_name}`)); ourNames.add(norm(`${s.first_name} ${s.last_name}`)); }
  const { data: existing } = await supabase.from("senators").select("slug");
  const slugs = new Set((existing || []).map((x: any) => x.slug));
  const slugify = (str: string) => (str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const newSen: any[] = [];
  for (const [mat, r] of activeByMat) {
    const nom = r[iNom] || "", pre = r[iPrenom] || "";
    if (ourNames.has(norm(`${nom} ${pre}`)) || ourNames.has(norm(`${pre} ${nom}`))) continue; // déjà en base
    let slug = slugify(`${pre} ${nom}`);
    if (slugs.has(slug)) slug = `${slug}-${(mat || "").toLowerCase()}`;
    slugs.add(slug);
    newSen.push({
      first_name: pre.trim(), last_name: nom.trim(), slug, senate_matricule: mat,
      photo_url: await findPhoto(nom, pre, mat),
      senate_group: (r[iGrp] || "").trim() || null, department: (r[iCirc] || "").trim() || null,
      birth_date: cleanDate(r[iNai]), profession: (r[iProf] || "").trim() || null,
      csp: (r[iCsp] || "").trim() || null, committee: (r[iCom] || "").trim() || null,
      email: (r[iMail] || "").trim() || null, sitting: true,
    });
  }
  if (newSen.length) {
    const { error: insErr } = await supabase.from("senators").insert(newSen);
    if (insErr) console.warn(`  ! insertion nouveaux sénateurs : ${insErr.message}`);
    else console.log(`> ${newSen.length} nouveau(x) sénateur(s) ajouté(s) (remplaçants).`);
  }

  console.log(`--- TERMINE. ${ok} sénateurs renseignés, ${miss} non trouvés, ${photos} photo(s) rattrapée(s). ---`);
  return ok;
}

if (process.argv[1] && process.argv[1].endsWith("sync-senator-odsen.ts")) {
  syncSenatorOdsen().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
