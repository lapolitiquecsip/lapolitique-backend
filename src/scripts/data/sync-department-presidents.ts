import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Présidents des conseils départementaux — source officielle RNE (data.gouv), qui porte
// la fonction exacte « Président du conseil départemental ». C'est la donnée autoritative
// et à jour du « qui préside quel département ».
const DATASET = "https://www.data.gouv.fr/api/1/datasets/repertoire-national-des-elus-1/";

// RNE écrit le NOM en majuscules ; on le remet en casse normale (« FRICOTEAUX » → « Fricoteaux »)
// pour l'affichage ET pour retrouver les articles Wikipédia / casier-politique.
const properCase = (s: string) => (s || "").toLowerCase().replace(/(^|[\s\-'])([a-zà-ÿ])/g, (_, sep, c) => sep + c.toUpperCase());

const slugify = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw) continue;
    const cells: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '"') { if (q && raw[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ";" && !q) { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

const cleanDate = (s: string) => { const m = (s || "").match(/(\d{4})[-/](\d{2})[-/](\d{2})/) || (s || "").match(/(\d{2})\/(\d{2})\/(\d{4})/); if (!m) return null; return m[0].includes("/") ? `${m[3]}-${m[2]}-${m[1]}` : `${m[1]}-${m[2]}-${m[3]}`; };

export async function syncDepartmentPresidents() {
  console.log("--- SYNC PRÉSIDENTS DE DÉPARTEMENT (RNE) ---");
  const meta: any = await (await fetch(DATASET, { headers: { "User-Agent": "LaPolitiqueBot/1.0" }, signal: AbortSignal.timeout(30000) })).json();
  const res = (meta.resources || []).find((r: any) => String(r.url).includes("conseillers-departementaux"));
  if (!res) throw new Error("Ressource RNE conseillers départementaux introuvable.");

  const buf = await (await fetch(res.url, { headers: { "User-Agent": "LaPolitiqueBot/1.0" }, signal: AbortSignal.timeout(45000) })).arrayBuffer();
  // Le fichier RNE peut être en UTF-8 ; on décode ainsi et on retombe sur latin1 si accents cassés.
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("�")) text = new TextDecoder("latin1").decode(buf);

  const rows = parseCsv(text);
  const hdr = rows[0];
  const H = (name: string) => hdr.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
  const iDep = H("Code du d"), iDepName = H("Libell") /* premier Libellé = département */,
        iNom = H("Nom de l"), iPre = H("nom de l") /* Prénom */, iNai = H("Date de naissance"),
        iCsp = H("Libellé de la catégorie") >= 0 ? H("Libellé de la catégorie") : H("cat"),
        iFonc = H("Libellé de la fonction"), iFoncDate = H("Date de début de la fonction");
  // Prénom est la colonne juste après « Nom de l'élu ».
  const iPrenom = iNom + 1;

  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of rows.slice(1)) {
    if ((r[iFonc] || "").trim() !== "Président du conseil départemental") continue;
    let dep = (r[iDep] || "").trim();
    // RNE écrit les codes métropolitains sans zéro initial ('1' au lieu de '01').
    // On aligne sur la nomenclature du site (2 chiffres ; 2A/2B et 97x inchangés).
    if (/^\d$/.test(dep)) dep = "0" + dep;
    const nom = properCase((r[iNom] || "").trim()), prenom = (r[iPrenom] || "").trim();
    if (!dep || !nom) continue;
    let slug = slugify(`${prenom} ${nom}`);
    if (seen.has(slug)) slug = `${slug}-${dep}`;
    seen.add(slug);
    out.push({
      dep_code: dep,
      dep_name: (r[iDepName] || "").trim() || null,
      first_name: prenom || null,
      last_name: nom,
      full_name: `${prenom} ${nom}`.trim(),
      slug,
      birth_date: cleanDate(r[iNai] || ""),
      csp: (r[iCsp] || "").trim() || null,
      mandate_since: cleanDate(r[iFoncDate] || ""),
      source_url: "https://www.data.gouv.fr/fr/datasets/repertoire-national-des-elus-1/",
      updated_at: new Date().toISOString(),
    });
  }
  console.log(`> ${out.length} présidents de département.`);
  if (out.length === 0) throw new Error("Aucun président extrait — on n'écrit rien.");

  for (let i = 0; i < out.length; i += 200) {
    const { error } = await supabase.from("department_presidents").upsert(out.slice(i, i + 200), { onConflict: "dep_code" });
    if (error) throw error;
  }
  console.log(`--- TERMINE. ${out.length} présidents. ---`);
  return out.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-department-presidents.ts")) {
  syncDepartmentPresidents().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
