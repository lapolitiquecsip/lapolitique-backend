import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../../config/supabase.js";

export async function reconcileLegislativeData() {
  const cutoff = new Date(Date.now() - 45 * 60_000).toISOString();
  const [{ count: staleCount, error: staleError }, { data: recentRuns, error: runError }] = await Promise.all([
    supabase.from("legislative_dossiers").select("id", { count: "exact", head: true }).lt("source_updated_at", cutoff).neq("status_code", "promulgated"),
    supabase.from("legislative_sync_runs").select("pipeline,status,started_at,details").order("started_at", { ascending: false }).limit(20),
  ]);
  if (staleError) throw staleError;
  if (runError) throw runError;

  const failures = new Map<string, number>();
  for (const run of recentRuns ?? []) {
    if (failures.has(run.pipeline)) continue;
    const samePipeline = (recentRuns ?? []).filter(candidate => candidate.pipeline === run.pipeline).slice(0, 2);
    failures.set(run.pipeline, samePipeline.length === 2 && samePipeline.every(candidate => candidate.status === "failed") ? 2 : 0);
  }
  const repeatedFailures = [...failures.entries()].filter(([, count]) => count >= 2).map(([pipeline]) => pipeline);
  const result = { staleActiveDossiers: staleCount ?? 0, repeatedFailures };
  console.log(JSON.stringify(result, null, 2));
  if (repeatedFailures.length) throw new Error(`Repeated legislative sync failures: ${repeatedFailures.join(", ")}`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  reconcileLegislativeData().catch(error => { console.error(error); process.exitCode = 1; });
}
