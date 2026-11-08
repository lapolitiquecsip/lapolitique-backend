import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Table `mayors` — source officielle RNE (data.gouv), CSV des maires (fonction « Maire »).
// C'est la donnée autoritative et complète (~34 900 communes). Population ajoutée via
// geo.api.gouv.fr pour le périmètre d'enrichissement et le tri.
const DATASET = "https://www.data.gouv.fr/api/1/datasets/repertoire-national-des-elus-1/";
const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
const DRY = process.argv.includes("--dry-run");
const slugify = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const properCase = (s: string) => (s || "").toLowerCase().replace(/(^|[\s\-'])([a-zà-ÿ])/g, (_, sep, c) => sep + c.toUpperCase());
const cleanDate = (s: string) => { const m = (s || "").match(/(\d{4})[-/](\d{2})[-/](\d{2})/) || (s || "").match(/(\d{2})\/(\d{2})\/(\d{4})/); if (!m) return null; return m[0].includes("/") ? `${m[3]}-${m[2]}-${m[1]}` : `${m[1]}-${m[2]}-${m[3]}`; };

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

export async function syncMayors() {
  console.log("--- SYNC MAIRES (RNE) ---");

  // 1) Population par commune (une requête).
  const communes: any[] = await (await fetch(
    "https://geo.api.gouv.fr/communes?fields=code,population&format=json", { headers: UA, signal: AbortSignal.timeout(60000) })).json();
  const popByInsee = new Map<string, number>(communes.map((c: any) => [c.code, c.population || 0]));

  // 2) CSV RNE des maires.
  const meta: any = await (await fetch(DATASET, { headers: UA, signal: AbortSignal.timeout(30000) })).json();
  // « elus-maires-….csv » est devenu « elus-maire-mai.csv » (août 2026) : le pluriel exigé ici
  // faisait échouer la tâche chaque mois depuis.
  const res = (meta.resources || []).find((r: any) => /maire/i.test(`${r.url} ${r.title}`) && /\.csv/i.test(String(r.url)));
  if (!res) throw new Error("Ressource RNE maires introuvable.");
  const buf = await (await fetch(res.url, { headers: UA, signal: AbortSignal.timeout(120000) })).arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("�")) text = new TextDecoder("latin1").decode(buf);

  const rows = parseCsv(text);
  const hdr = rows[0];
  const H = (name: string) => hdr.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
  const iIns = H("Code de la commune") >= 0 ? H("Code de la commune") : H("Code commune"),
        iCom = H("Libellé de la commune"),
        iNom = H("Nom de l'"), iNai = H("Date de naissance"),
        iSex = H("Code sexe") >= 0 ? H("Code sexe") : H("sexe"),
        iCsp = H("catégorie socio") >= 0 ? H("catégorie socio") : H("Libellé de la cat"),
        iDeb = H("Date de début du mandat") >= 0 ? H("Date de début du mandat") : H("Date de début de mandat");
  const iPre = iNom + 1; // Prénom juste après « Nom de l'élu »

  // État actuel : on garde l'adresse de fiche (slug) et la bio d'un maire toujours en place.
  // Clé sur 5 caractères : l'ancien fichier RNE donnait « 1001 », le nouveau « 01001 » (comme
  // geo.api.gouv.fr, que lit le site) ; les fiches des départements 01 à 09 étaient introuvables.
  const cinq = (c: string) => (/^\d{1,4}$/.test(c) ? c.padStart(5, "0") : c);
  const existants = new Map<string, { full_name: string; slug: string; code: string }>();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from("mayors").select("insee_code, full_name, slug").order("insee_code").range(de, de + 999);
    if (error) throw error;
    for (const m of data ?? []) existants.set(cinq(m.insee_code), { full_name: m.full_name, slug: m.slug, code: m.insee_code });
    if (!data || data.length < 1000) break;
  }
  const slugsPris = new Set([...existants.values()].map(m => m.slug));
  const nomNorm = (s: string) => slugify(s || "");

  const seen = new Set<string>();
  const byInsee = new Map<string, any>();
  for (const r of rows.slice(1)) {
    const insee = cinq((r[iIns] || "").trim());
    const last = properCase((r[iNom] || "").trim()), first = (r[iPre] || "").trim();
    if (!insee || !last || byInsee.has(insee)) continue; // une ligne « Maire » par commune
    const avant = existants.get(insee);
    const memePersonne = !!avant && nomNorm(avant.full_name) === nomNorm(`${first} ${last}`);
    let slug = memePersonne ? avant!.slug : slugify(`${first} ${last}`);
    // Nouveau maire : jamais l'adresse d'une autre fiche (en base ou dans ce lot).
    if (!memePersonne && (seen.has(slug) || slugsPris.has(slug))) slug = `${slug}-${insee}`;
    seen.add(slug);
    byInsee.set(insee, {
      // Changement de maire : la bio, la photo, le parti et la situation juridique de
      // l'ancien ne doivent pas passer sur la fiche du nouveau.
      ...(avant && !memePersonne ? { bio: null, biography: null, photo_url: null, party: null, legal_issues: null } : {}),
      insee_code: insee,
      commune_name: (r[iCom] || "").trim() || null,
      population: popByInsee.get(insee) ?? null,
      first_name: first || null,
      last_name: last,
      full_name: `${first} ${last}`.trim(),
      slug,
      sex: (r[iSex] || "").trim() || null,
      birth_date: cleanDate(r[iNai] || ""),
      mandate_since: cleanDate(r[iDeb] || ""),
      source_url: "https://www.data.gouv.fr/fr/datasets/repertoire-national-des-elus-1/",
      updated_at: new Date().toISOString(),
    }); }
  const rowsOut = [...byInsee.values()];
  console.log(`> ${rowsOut.length} maires.`);
  if (rowsOut.length < 30000) throw new Error(`Trop peu de maires (${rowsOut.length}) — CSV suspect, on n'écrit rien.`);

  // Plus de purge totale (08/11/2026) : elle effaçait chaque mois les 3 600 bios. Seules les
  // communes disparues (fusions) sortent ; les autres lignes sont mises à jour en place.
  const disparues = [...existants.keys()].filter(c => !byInsee.has(c));
  const changes = rowsOut.filter(r => "bio" in r).length;
  console.log(`> ${disparues.length} commune(s) disparue(s), ${changes} changement(s) de maire.`);
  if (DRY) {
    console.log("  ex. disparues :", disparues.slice(0, 12).join(" "), "| ex. nouvelles :", [...byInsee.keys()].filter(c => !existants.has(c)).slice(0, 12).join(" "));
    console.log("--- ESSAI : rien d'écrit. ---"); return rowsOut.length;
  }
  // Codes sans zéro initial : renommés en place (la bio suit), une seule fois.
  const aRenommer = [...existants.entries()].filter(([cle, m]) => m.code !== cle && byInsee.has(cle));
  for (const [cle, m] of aRenommer) {
    const { error } = await supabase.from("mayors").update({ insee_code: cle }).eq("insee_code", m.code);
    if (error) throw error;
  }
  if (aRenommer.length) console.log(`> ${aRenommer.length} code(s) INSEE complété(s) sur 5 chiffres.`);
  const anciensCodes = disparues.map(c => existants.get(c)!.code);
  for (let i = 0; i < anciensCodes.length; i += 200) {
    const { error } = await supabase.from("mayors").delete().in("insee_code", anciensCodes.slice(i, i + 200));
    if (error) throw error;
  }

  // Deux formes de lignes (avec ou sans remise à zéro de la bio) : PostgREST exige des clés
  // identiques dans un même envoi, d'où deux passes.
  for (const lot of [rowsOut.filter(r => !("bio" in r)), rowsOut.filter(r => "bio" in r)]) {
    for (let i = 0; i < lot.length; i += 500) {
      const { error } = await supabase.from("mayors").upsert(lot.slice(i, i + 500), { onConflict: "insee_code" });
      if (error) throw error;
      process.stdout.write(`\r  upsert ${Math.min(i + 500, lot.length)}/${lot.length}`);
    }
  }
  console.log(`\n--- TERMINE. ${rowsOut.length} maires. ---`);
  return rowsOut.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-mayors.ts")) {
  syncMayors().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
