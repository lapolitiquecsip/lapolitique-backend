import "dotenv/config";
import readline from "node:readline";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import unzipper from "unzipper";
import { supabase } from "../../config/supabase.js";
import { parseDoslegDump } from "../../lib/legislative/dosleg-adapter.js";
import { stableHash } from "../../lib/legislative/normalization.js";
import { trackLegislativeSync } from "../../lib/legislative/sync-run.js";

const DATASET_API = "https://www.data.gouv.fr/api/1/datasets/53ae96eaa3a729709f56d51d/";
const RESOURCE_ID = "ce330551-f159-4f93-bbaa-4028e8fe1ae3";
const chunks = <T>(values: T[], size = 500) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\W+/g, " ").trim();

export async function syncSenateScrutins() {
  return trackLegislativeSync("senate_scrutins", async () => {
  const metadataResponse = await fetch(DATASET_API, { signal: AbortSignal.timeout(30_000) });
  if (!metadataResponse.ok) throw new Error(`data.gouv.fr dataset HTTP ${metadataResponse.status}`);
  const metadata = await metadataResponse.json() as any;
  const resource = metadata.resources?.find((item: any) => item.id === RESOURCE_ID);
  if (!resource?.url || !resource?.last_modified) throw new Error("DOSLEG resource metadata is unavailable");
  const versionHash = stableHash({ id: resource.id, modified: resource.last_modified });
  const { count } = await supabase.from("legislative_source_records").select("id", { count: "exact", head: true }).eq("provider", "DATAGOUV").eq("record_type", "dataset_resource").eq("official_id", RESOURCE_ID).eq("source_hash", versionHash);
  if ((count ?? 0) > 0) { console.log("Senate DOSLEG resource unchanged; nothing to import."); return 0; }
  const response = await fetch(resource.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`DOSLEG archive HTTP ${response.status}`);
  const sql = Readable.fromWeb(response.body as any).pipe(unzipper.ParseOne(/dosleg\.sql$/));
  const records = await parseDoslegDump(readline.createInterface({ input: sql, crlfDelay: Infinity }));
  const { data: dossiers, error: dossierError } = await supabase.from("legislative_dossiers").select("id,title").eq("legislature", 17);
  if (dossierError) throw dossierError;
  const linked = records.flatMap(record => {
    const title = normalized(record.title);
    const dossier = (dossiers ?? []).find(candidate => title.includes(normalized(candidate.title)) || normalized(candidate.title).includes(title));
    return dossier ? [{ record, dossierId: dossier.id }] : [];
  });
  for (const batch of chunks(linked)) {
    const { error } = await supabase.from("legislative_scrutins").upsert(batch.map(({ record, dossierId }) => ({ official_id: record.officialId, dossier_id: dossierId, chamber: "SENAT", title: record.title, result_code: record.resultLabel, result_label: record.resultLabel, for_count: record.forCount, against_count: record.againstCount, abstain_count: record.abstainCount, voted_at: new Date(`${record.votedAt}T12:00:00Z`).toISOString(), source_url: record.sourceUrl, source_updated_at: resource.last_modified, source_hash: record.sourceHash })), { onConflict: "official_id" });
    if (error) throw error;
  }
  const ids = new Map<string, string>();
  for (const batch of chunks(linked.map(value => value.record.officialId))) {
    const { data, error } = await supabase.from("legislative_scrutins").select("id,official_id").in("official_id", batch);
    if (error) throw error;
    for (const row of data ?? []) ids.set(row.official_id, row.id);
  }
  const votes = linked.flatMap(({ record }) => record.votes.map(vote => ({ scrutin_id: ids.get(record.officialId), voter_official_id: vote.voterOfficialId, voter_name: vote.voterName, group_code: vote.groupCode, position: vote.position }))).filter(row => row.scrutin_id);
  const groups = linked.flatMap(({ record }) => record.groupResults.map(group => ({ scrutin_id: ids.get(record.officialId), group_code: group.groupCode, for_count: group.forCount, against_count: group.againstCount, abstain_count: group.abstainCount, non_voting_count: group.nonVotingCount }))).filter(row => row.scrutin_id);
  for (const batch of chunks(votes)) { const { error } = await supabase.from("legislative_votes").upsert(batch, { onConflict: "scrutin_id,voter_official_id" }); if (error) throw error; }
  for (const batch of chunks(groups)) { const { error } = await supabase.from("legislative_group_results").upsert(batch, { onConflict: "scrutin_id,group_code" }); if (error) throw error; }
  const { error: sourceError } = await supabase.from("legislative_source_records").upsert({ provider: "DATAGOUV", record_type: "dataset_resource", official_id: RESOURCE_ID, source_url: resource.url, source_updated_at: resource.last_modified, source_hash: versionHash, raw_excerpt: { dataset_id: metadata.id, linked: linked.length, total: records.length } }, { onConflict: "provider,record_type,official_id,source_hash" });
  if (sourceError) throw sourceError;
  console.log(`Senate DOSLEG: ${linked.length} scrutins linked, ${votes.length} nominative votes.`);
  return linked.length;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) syncSenateScrutins().catch(error => { console.error(error); process.exitCode = 1; });
