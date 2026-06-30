import "dotenv/config";
import AdmZip from "adm-zip";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../../config/supabase.js";
import { parseAssembleeScrutin } from "../../lib/legislative/scrutin-adapter.js";

const URL = "https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip";
const chunks = <T>(values: T[], size = 500) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

export async function syncScrutins() {
  const { data: run, error: runError } = await supabase.from("legislative_sync_runs").insert({ pipeline: "scrutins_an", status: "running" }).select("id").single();
  if (runError) throw runError;
  try {
    const [archiveResponse, dossiersResult, deputiesResult] = await Promise.all([
      fetch(URL, { signal: AbortSignal.timeout(120_000) }),
      supabase.from("legislative_dossiers").select("id,official_id,title").eq("legislature", 17),
      supabase.from("deputies").select("an_id,first_name,last_name"),
    ]);
    if (!archiveResponse.ok) throw new Error(`AN scrutins archive HTTP ${archiveResponse.status}`);
    if (dossiersResult.error) throw dossiersResult.error;
    if (deputiesResult.error) throw deputiesResult.error;
    const dossiers = (dossiersResult.data ?? []).map(row => ({ id: row.id, officialId: row.official_id, title: row.title }));
    const actors = new Map((deputiesResult.data ?? []).map(row => [row.an_id, `${row.first_name} ${row.last_name}`.trim()]));
    const zip = new AdmZip(Buffer.from(await archiveResponse.arrayBuffer()));
    const parsed = zip.getEntries().filter(entry => entry.entryName.endsWith(".json"))
      .map(entry => parseAssembleeScrutin(JSON.parse(entry.getData().toString("utf8")), dossiers, actors))
      .filter((value): value is NonNullable<typeof value> => value !== null);

    const amendments = parsed.flatMap(value => value.amendment ? [value.amendment] : []);
    for (const batch of chunks(amendments)) {
      const { error } = await supabase.from("legislative_amendments").upsert(batch.map(value => ({ official_id: value.officialId, dossier_id: value.dossierId, chamber: value.chamber, number: value.number, author_name: value.authorName, subject: value.subject, outcome_code: value.outcomeCode, outcome_label: value.outcomeLabel, voted_at: value.votedAt, source_url: value.sourceUrl, source_updated_at: value.sourceUpdatedAt, source_hash: value.sourceHash })), { onConflict: "official_id" });
      if (error) throw error;
    }
    const amendmentIds = new Map<string, string>();
    for (const batch of chunks(amendments.map(value => value.officialId))) {
      const { data, error } = await supabase.from("legislative_amendments").select("id,official_id").in("official_id", batch);
      if (error) throw error;
      for (const row of data ?? []) amendmentIds.set(row.official_id, row.id);
    }
    for (const batch of chunks(parsed)) {
      const { error } = await supabase.from("legislative_scrutins").upsert(batch.map(value => ({ official_id: value.scrutin.officialId, dossier_id: value.scrutin.dossierId, amendment_id: value.amendment ? amendmentIds.get(value.amendment.officialId) : null, chamber: value.scrutin.chamber, title: value.scrutin.title, result_code: value.scrutin.resultCode, result_label: value.scrutin.resultLabel, for_count: value.scrutin.forCount, against_count: value.scrutin.againstCount, abstain_count: value.scrutin.abstainCount, voted_at: value.scrutin.votedAt, source_url: value.scrutin.sourceUrl, source_updated_at: value.scrutin.sourceUpdatedAt, source_hash: value.scrutin.sourceHash })), { onConflict: "official_id" });
      if (error) throw error;
    }
    for (const batch of chunks(parsed)) {
      const { error } = await supabase.from("legislative_source_records").upsert(batch.map(value => ({
        provider: "AN", record_type: "scrutin", official_id: value.scrutin.officialId,
        source_url: value.scrutin.sourceUrl, source_updated_at: value.scrutin.sourceUpdatedAt,
        source_hash: value.scrutin.sourceHash, raw_excerpt: { title: value.scrutin.title, result: value.scrutin.resultLabel },
      })), { onConflict: "provider,record_type,official_id,source_hash" });
      if (error) throw error;
    }
    const scrutinIds = new Map<string, string>();
    for (const batch of chunks(parsed.map(value => value.scrutin.officialId))) {
      const { data, error } = await supabase.from("legislative_scrutins").select("id,official_id").in("official_id", batch);
      if (error) throw error;
      for (const row of data ?? []) scrutinIds.set(row.official_id, row.id);
    }
    const votes = parsed.flatMap(value => value.votes.map(vote => ({ scrutin_id: scrutinIds.get(value.scrutin.officialId), voter_official_id: vote.voterOfficialId, voter_name: vote.voterName, group_code: vote.groupCode, position: vote.position }))).filter(value => value.scrutin_id);
    for (const batch of chunks(votes)) {
      const { error } = await supabase.from("legislative_votes").upsert(batch, { onConflict: "scrutin_id,voter_official_id" });
      if (error) throw error;
    }
    const groups = parsed.flatMap(value => value.groupResults.map(group => ({ scrutin_id: scrutinIds.get(value.scrutin.officialId), group_code: group.groupCode, for_count: group.forCount, against_count: group.againstCount, abstain_count: group.abstainCount, non_voting_count: group.nonVotingCount }))).filter(value => value.scrutin_id && value.group_code);
    for (const batch of chunks(groups)) {
      const { error } = await supabase.from("legislative_group_results").upsert(batch, { onConflict: "scrutin_id,group_code" });
      if (error) throw error;
    }
    await supabase.from("legislative_sync_runs").update({ status: "success", finished_at: new Date().toISOString(), processed_count: parsed.length, details: { amendments: amendments.length, votes: votes.length } }).eq("id", run.id);
    console.log(`AN scrutins: ${parsed.length} linked, ${amendments.length} amendment votes, ${votes.length} individual votes.`);
  } catch (error: any) {
    await supabase.from("legislative_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_count: 1, details: { error: error.message } }).eq("id", run.id);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) syncScrutins().catch(error => { console.error(error); process.exitCode = 1; });
