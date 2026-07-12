import "dotenv/config";
import { parse } from "csv-parse";
import { Readable } from "node:stream";
import { supabase } from "../../config/supabase.js";

// Sélection d'indicateurs ITDD (Insee/SDES) à intégrer.
const WHITELIST = new Set([
  "agribio_nbexp", "agribio_surf", "part_agribio_surf",
  "esper_vie", "bas_niveau_francais", "bas_niveau_maths",
  "nb_maires_femme", "part_maires_femme", "conso_fin_ener",
  "puissance_inst", "taux_chom_bit",
  "log_hlm_tot", "part_pls", "nb_vacant_pls",
  "infrac_tx_usagstup", "infrac_tx_traficstup", "ElectionPres_T1_votants",
  "qualair_PM10", "qualair_PM25", "qualair_NO2", "qualair_O3", "qualair_SO2",
]);

const DATASET_API = "https://www.data.gouv.fr/api/1/datasets/indicateurs-territoriaux-de-developpement-durable-itdd/";
const MIN_YEAR = 1995;

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function extractRows(r: any, level: string, latestOnly: boolean) {
  const code = r.CODGEO_CODE;
  const base = {
    level, territory_code: String(code), variable: r.VARIABLE,
    sub_field: r.LIBELLE_SOUS_CHAMP || "", unit: r.UNITE || null,
    label: r.LIBELLE_VARIABLE || null, odd: r.ODD1 || null,
    updated_at: new Date().toISOString(),
  };
  const out: any[] = [];
  if (latestOnly) {
    for (let y = 2025; y >= MIN_YEAR; y--) { const v = num(r["A" + y]); if (v != null) { out.push({ ...base, year: y, value: v }); break; } }
  } else {
    for (let y = MIN_YEAR; y <= 2025; y++) { const v = num(r["A" + y]); if (v != null) out.push({ ...base, year: y, value: v }); }
  }
  return out;
}

async function* streamCsv(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": "LaPolitiqueBot/1.0" }, signal: AbortSignal.timeout(300000) });
  if (!res.ok || !res.body) throw new Error(`ITDD HTTP ${res.status}: ${url}`);
  const source = Readable.fromWeb(res.body as any);
  const parser = parse({ columns: true, delimiter: ";", relax_quotes: true, relax_column_count: true, skip_empty_lines: true });
  // Propage les erreurs du téléchargement au parser pour qu'elles soient
  // attrapées par le retry (sinon 'error' non géré = crash du process).
  source.on("error", (e) => parser.destroy(e));
  source.pipe(parser);
  for await (const record of parser) yield record;
}

async function upsertBatch(rows: any[]) {
  const { error } = await supabase.from("itdd_indicators").upsert(rows, { onConflict: "level,territory_code,variable,sub_field,year" });
  if (error) console.error("[ITDD] upsert:", error.message);
}

async function ingestOnce(url: string, level: string, latestOnly: boolean) {
  let batch: any[] = [];
  let n = 0;
  for await (const r of streamCsv(url)) {
    if (!WHITELIST.has(r.VARIABLE) || !r.CODGEO_CODE) continue;
    batch.push(...extractRows(r, level, latestOnly));
    if (batch.length >= 1000) { await upsertBatch(batch); n += batch.length; batch = []; }
  }
  if (batch.length) { await upsertBatch(batch); n += batch.length; }
  return n;
}

// Les téléchargements DIDO coupent parfois (UND_ERR_SOCKET). On réessaie le
// fichier plutôt que d'abandonner tout le run (upsert idempotent).
async function ingest(url: string, level: string, latestOnly: boolean, attempts = 4) {
  for (let a = 1; a <= attempts; a++) {
    try { return await ingestOnce(url, level, latestOnly); }
    catch (e: any) {
      console.warn(`[ITDD] échec ${a}/${attempts} (${level}) : ${e.message}`);
      if (a < attempts) await new Promise(r => setTimeout(r, a * 3000));
    }
  }
  console.error(`[ITDD] abandon du fichier ${url}`);
  return 0;
}

export async function syncItdd() {
  const meta: any = await (await fetch(DATASET_API, { headers: { "User-Agent": "LaPolitiqueBot/1.0" } })).json();
  const csvs = (meta.resources || []).filter((r: any) => r.format === "csv");
  const regionRes = csvs.find((r: any) => /Toutes r[ée]gions/i.test(r.title));
  const deptRes = csvs.find((r: any) => /Tous d[ée]partements/i.test(r.title));
  const communeRes = csvs.filter((r: any) => /Toutes les communes/i.test(r.title));

  let total = 0;
  if (regionRes) { const n = await ingest(regionRes.url, "region", false); total += n; console.log(`[ITDD] région: ${n}`); }
  if (deptRes) { const n = await ingest(deptRes.url, "department", false); total += n; console.log(`[ITDD] département: ${n}`); }
  for (const cr of communeRes) {
    const n = await ingest(cr.url, "commune", true);
    total += n;
    console.log(`[ITDD] ${cr.title}: ${n}`);
  }
  console.log(`[ITDD] Terminé. ${total} lignes.`);
  return total;
}

if (process.argv[1] && process.argv[1].endsWith("sync-itdd.ts")) {
  syncItdd().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
