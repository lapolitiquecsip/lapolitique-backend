import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Table `mayors` — source officielle RNE (data.gouv), CSV des maires (fonction « Maire »).
// C'est la donnée autoritative et complète (~34 900 communes). Population ajoutée via
// geo.api.gouv.fr pour le périmètre d'enrichissement et le tri.
const DATASET = "https://www.data.gouv.fr/api/1/datasets/repertoire-national-des-elus-1/";
const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
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
  const res = (meta.resources || []).find((r: any) => /maires/i.test(String(r.url)) && /\.csv/i.test(String(r.url)));
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

  const seen = new Set<string>();
  const byInsee = new Map<string, any>();
  for (const r of rows.slice(1)) {
    const insee = (r[iIns] || "").trim();
    const last = properCase((r[iNom] || "").trim()), first = (r[iPre] || "").trim();
    if (!insee || !last || byInsee.has(insee)) continue; // une ligne « Maire » par commune
    let slug = slugify(`${first} ${last}`);
    if (seen.has(slug)) slug = `${slug}-${insee}`;
    seen.add(slug);
    byInsee.set(insee, {
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

  // Purge (repart propre : évite les collisions de slug avec un état partiel antérieur).
  await supabase.from("mayors").delete().neq("insee_code", "__none__");

  for (let i = 0; i < rowsOut.length; i += 500) {
    const { error } = await supabase.from("mayors").upsert(rowsOut.slice(i, i + 500), { onConflict: "insee_code" });
    if (error) throw error;
    process.stdout.write(`\r  upsert ${Math.min(i + 500, rowsOut.length)}/${rowsOut.length}`);
  }
  console.log(`\n--- TERMINE. ${rowsOut.length} maires. ---`);
  return rowsOut.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-mayors.ts")) {
  syncMayors().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
