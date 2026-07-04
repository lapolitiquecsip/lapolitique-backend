import { Readable } from "node:stream";
import { parse } from "csv-parse";
import { OFFICIAL_SOURCES, runIngestion, sha256, upsertInChunks } from "../../lib/data-platform.js";
import { supabase } from "../../config/supabase.js";

const source = OFFICIAL_SOURCES.find(item => item.slug === "interieur-elections")!;
const electionId = process.env.ELECTION_ID ?? "2026_muni_t2";
const generalUrl = "https://object.files.data.gouv.fr/data-pipeline-open/elections/general_results.csv";
const candidatesUrl = "https://object.files.data.gouv.fr/data-pipeline-open/elections/candidats_results.csv";
const integer = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

async function csvRows(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`Election resource failed: HTTP ${response.status}`);
  return Readable.fromWeb(response.body as any).pipe(parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }));
}

await runIngestion({ domain: "elections", jobName: `sync-election-${electionId}`, source }, async ({ dryRun }) => {
  const round = Number(electionId.match(/_t(\d+)$/)?.[1]);
  if (!round) throw new Error(`ELECTION_ID must end with _tN, received ${electionId}`);
  const general = new Map<string, { registered: number; voters: number; expressed: number }>();
  let rowsRead = 0;
  for await (const row of await csvRows(generalUrl)) {
    if (row.id_election !== electionId || !row.code_commune) continue;
    rowsRead++;
    const value = general.get(row.code_commune) ?? { registered: 0, voters: 0, expressed: 0 };
    value.registered += integer(row.inscrits); value.voters += integer(row.votants); value.expressed += integer(row.exprimes);
    general.set(row.code_commune, value);
  }
  if (!general.size) throw new Error(`No general results found for ${electionId}; previous values were preserved`);
  const results = new Map<string, Record<string, unknown>>();
  for await (const row of await csvRows(candidatesUrl)) {
    if (row.id_election !== electionId || !row.code_commune) continue;
    rowsRead++;
    const candidateName = [row.prenom, row.nom].filter(Boolean).join(" ").trim() || row.liste || row.libelle_etendu_liste || row.binome || "";
    const panel = String(row.no_panneau ?? "");
    const candidateId = panel || sha256([candidateName, row.liste ?? "", row.Nuance ?? ""].join("|")).slice(0, 20);
    const key = `${row.code_commune}:${candidateId}`;
    const base = general.get(row.code_commune)!;
    const current = results.get(key) ?? { election_official_id: electionId, round, territory_code: row.code_commune, candidate_official_id: candidateId, candidate_name: candidateName || null, list_name: row.libelle_etendu_liste || row.liste || null, nuance_code: row.Nuance || null, registered: base.registered, voters: base.voters, expressed: base.expressed, votes: 0, elected: false, source_urls: [generalUrl, candidatesUrl], source_updated_at: new Date().toISOString(), collected_at: new Date().toISOString(), quality_status: "verified" };
    current.votes = integer(current.votes) + integer(row.voix);
    results.set(key, current);
  }
  if (!results.size) throw new Error(`No candidate results found for ${electionId}; previous values were preserved`);
  let written = 0;
  if (!dryRun) {
    const type = electionId.replace(/^\d{4}_/, "").replace(/_t\d+$/, "");
    const { error } = await supabase.from("elections").upsert({ official_id: electionId.replace(/_t\d+$/, ""), name: electionId.replace(/_/g, " "), election_type: type, round_count: round, source_urls: [generalUrl, candidatesUrl], source_updated_at: new Date().toISOString(), collected_at: new Date().toISOString() }, { onConflict: "official_id" });
    if (error) throw error;
    const normalized = [...results.values()].map(row => ({ ...row, election_official_id: electionId.replace(/_t\d+$/, "") }));
    written = 1 + await upsertInChunks("election_results", normalized, "election_official_id,round,territory_code,candidate_official_id", 250);
  }
  console.log(`${dryRun ? "Validated" : "Published"} ${results.size} aggregated results for ${electionId}.`);
  return { result: undefined, rowsRead, rowsWritten: written, details: { electionId, territories: general.size } };
});
