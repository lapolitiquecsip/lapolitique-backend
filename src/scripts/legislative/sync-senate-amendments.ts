import "dotenv/config";
import readline from "node:readline";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import unzipper from "unzipper";
import { supabase } from "../../config/supabase.js";
import { parseAmeliDump } from "../../lib/legislative/ameli-adapter.js";
import { stableHash } from "../../lib/legislative/normalization.js";
import { trackLegislativeSync } from "../../lib/legislative/sync-run.js";

const DATASET_API = "https://www.data.gouv.fr/api/1/datasets/53a8b7f8a3a72905b7ce595d/";
const RESOURCE_ID = "35253631-23d5-4237-b20b-d485ae3ee716";
const chunks = <T>(values: T[], size = 500) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

export async function syncSenateAmendments() {
  return trackLegislativeSync("senate_amendments", async () => {
  const metadataResponse = await fetch(DATASET_API, { signal: AbortSignal.timeout(30_000) });
  if (!metadataResponse.ok) throw new Error(`data.gouv.fr dataset HTTP ${metadataResponse.status}`);
  const metadata = await metadataResponse.json() as any;
  const resource = metadata.resources?.find((item: any) => item.id === RESOURCE_ID);
  if (!resource?.url || !resource?.last_modified) throw new Error("AMELI resource metadata is unavailable");
  const versionHash = stableHash({ id: resource.id, modified: resource.last_modified });
  const { count } = await supabase.from("legislative_source_records").select("id", { count: "exact", head: true })
    .eq("provider", "DATAGOUV").eq("record_type", "dataset_resource").eq("official_id", RESOURCE_ID).eq("source_hash", versionHash);
  if ((count ?? 0) > 0) { console.log("Senate AMELI resource unchanged; nothing to import."); return 0; }

  const response = await fetch(resource.url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error(`AMELI archive HTTP ${response.status}`);
  const archive = Readable.fromWeb(response.body as any);
  const sql = archive.pipe(unzipper.ParseOne(/ameli\.sql$/));
  const lines = readline.createInterface({ input: sql, crlfDelay: Infinity });
  const records = await parseAmeliDump(lines);
  const { data: dossiers, error: dossierError } = await supabase.from("legislative_dossiers").select("id,official_id,source_urls").eq("legislature", 17);
  if (dossierError) throw dossierError;
  const bySignet = new Map<string, string>();
  for (const dossier of dossiers ?? []) {
    if (dossier.official_id.startsWith("SENAT:")) bySignet.set(dossier.official_id.slice(6), dossier.id);
    for (const url of dossier.source_urls ?? []) {
      const signet = url.match(/dossier-legislatif\/([^.]+)\.html/)?.[1];
      if (signet) bySignet.set(signet, dossier.id);
    }
  }
  const rows = records.flatMap(record => {
    const dossierId = bySignet.get(record.signet);
    if (!dossierId) return [];
    const sourceUrl = `https://www.senat.fr/dossier-legislatif/${record.signet}.html`;
    return [{ official_id: record.officialId, dossier_id: dossierId, chamber: "SENAT", number: record.number,
      author_name: record.authorName, subject: record.subject, body: record.body, outcome_code: record.outcomeCode,
      outcome_label: record.outcomeLabel, voted_at: record.depositedAt, source_url: sourceUrl,
      source_updated_at: resource.last_modified, source_hash: record.sourceHash }];
  });
  for (const batch of chunks(rows)) {
    const { error } = await supabase.from("legislative_amendments").upsert(batch, { onConflict: "official_id" });
    if (error) throw error;
  }
  const { error: sourceError } = await supabase.from("legislative_source_records").upsert({
    provider: "DATAGOUV", record_type: "dataset_resource", official_id: RESOURCE_ID,
    source_url: resource.url, source_updated_at: resource.last_modified, source_hash: versionHash,
    raw_excerpt: { dataset_id: metadata.id, title: resource.title, imported: rows.length },
  }, { onConflict: "provider,record_type,official_id,source_hash" });
  if (sourceError) throw sourceError;
  console.log(`Senate AMELI: ${rows.length} recent amendments synchronized.`);
  return rows.length;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) syncSenateAmendments().catch(error => { console.error(error); process.exitCode = 1; });
