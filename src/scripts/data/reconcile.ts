import { supabase } from "../../config/supabase.js";
import { runIngestion } from "../../lib/data-platform.js";

await runIngestion({ domain: "platform", jobName: "data-reconcile", mode: "reconcile" }, async ({ runId, dryRun }) => {
  const { data: freshness, error } = await supabase.rpc("public_data_freshness", { p_domain: null });
  if (error) throw error;
  const stale = (freshness ?? []).filter((item: any) => item.data_freshness !== "fresh" || item.quality_status !== "verified");
  if (!dryRun && stale.length) {
    const issues = stale.map((item: any) => ({ run_id: runId, domain: item.domain, issue_type: "stale_source", severity: item.quality_status === "warning" ? "error" : "warning", official_id: item.source, message: `Source ${item.source} is ${item.data_freshness}`, details: item }));
    const { error: issueError } = await supabase.from("data_quality_issues").insert(issues);
    if (issueError) throw issueError;
  }
  console.log(JSON.stringify({ sources: freshness?.length ?? 0, stale: stale.length }, null, 2));
  if (stale.some((item: any) => item.quality_status === "warning")) throw new Error("At least one source has two consecutive failures");
  return { result: undefined, rowsRead: freshness?.length ?? 0, rowsWritten: dryRun ? 0 : stale.length };
});
