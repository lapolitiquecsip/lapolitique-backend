import { supabase } from "../../config/supabase.js";

export async function trackLegislativeSync<T>(pipeline: string, task: () => Promise<T>): Promise<T> {
  const { data: run, error } = await supabase.from("legislative_sync_runs").insert({ pipeline, status: "running" }).select("id").single();
  if (error) throw error;
  try {
    const result = await task();
    const processed = typeof result === "number" ? result : 0;
    await supabase.from("legislative_sync_runs").update({ status: "success", finished_at: new Date().toISOString(), processed_count: processed }).eq("id", run.id);
    return result;
  } catch (cause: any) {
    await supabase.from("legislative_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_count: 1, details: { error: cause?.message ?? String(cause) } }).eq("id", run.id);
    throw cause;
  }
}
