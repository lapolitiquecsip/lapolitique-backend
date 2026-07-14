import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { supabase } from "../../config/supabase.js";
import { parseSenateText } from "../../lib/legislative/senate-adapter.js";

const INDEXES = ["https://www.senat.fr/akomantoso/depots.xml", "https://www.senat.fr/akomantoso/adoptions.xml"];
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
const array = <T>(value: T | T[] | null | undefined): T[] => value == null ? [] : Array.isArray(value) ? value : [value];
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\W+/g, " ").trim();

// senat.fr est parfois lent \u2192 retries avec backoff pour \u00e9viter les \u00e9checs intermittents.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function fetchRetry(url: string, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(45_000) });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(2000 * attempt);
    }
  }
  throw lastError;
}

export async function syncSenate() {
  const { data: run, error: runError } = await supabase.from("legislative_sync_runs").insert({ pipeline: "senate", status: "running" }).select("id").single();
  if (runError) throw runError;
  try {
    const indexBodies = await Promise.all(INDEXES.map(async url => {
      const response = await fetchRetry(url);
      if (!response.ok) throw new Error(`Senate index HTTP ${response.status}`);
      return response.text();
    }));
    const references = new Map<string, string>();
    for (const body of indexBodies) {
      for (const text of array(parser.parse(body)?.texts?.text) as any[]) {
        if (text?.url && String(text.lastModifiedDateTime ?? "") >= "2024-07-01") references.set(text.url, text.lastModifiedDateTime);
      }
    }
    const entries = [...references.entries()];
    const parsed = [];
    for (let index = 0; index < entries.length; index += 12) {
      const batch = entries.slice(index, index + 12);
      const values = await Promise.all(batch.map(async ([url, modified]) => {
        try {
          const response = await fetchRetry(url);
          if (!response.ok) return null;
          return parseSenateText(await response.text(), new Date(`${modified}Z`).toISOString());
        } catch { return null; }
      }));
      parsed.push(...values.filter((value): value is NonNullable<typeof value> => value !== null));
    }
    const { data: existing, error: existingError } = await supabase.from("legislative_dossiers").select("id,official_id,title,source_urls,author_name").eq("legislature", 17);
    if (existingError) throw existingError;
    const byTitle = new Map((existing ?? []).map(row => [normalized(row.title), row]));
    let inserted = 0;
    let merged = 0;
    for (const item of parsed) {
      const match = byTitle.get(normalized(item.title));
      let dossierId = match?.id;
      if (match) {
        const { error } = await supabase.from("legislative_dossiers").update({
          source_urls: [...new Set([...(match.source_urls ?? []), ...item.sourceUrls])],
          current_chamber: "SENAT", status_code: item.statusCode, status_label: item.statusLabel,
          latest_step_at: item.latestStepAt, source_updated_at: item.sourceUpdatedAt, updated_at: new Date().toISOString(),
        }).eq("id", match.id);
        if (error) throw error;
        merged++;
      } else {
        const { data, error } = await supabase.from("legislative_dossiers").upsert({
          official_id: item.officialId, legislature: 17, title: item.title, text_type: item.textType,
          author_kind: item.authorKind, author_name: item.authorName, category: item.category,
          status_code: item.statusCode, status_label: item.statusLabel, current_chamber: item.currentChamber,
          deposited_at: item.depositedAt, latest_step_at: item.latestStepAt, source_urls: item.sourceUrls,
          source_updated_at: item.sourceUpdatedAt, source_hash: item.sourceHash, updated_at: new Date().toISOString(),
        }, { onConflict: "official_id" }).select("id").single();
        if (error) throw error;
        dossierId = data.id;
        inserted++;
      }
      if (!dossierId) continue;
      const { error: sourceError } = await supabase.from("legislative_source_records").upsert({
        provider: "SENAT", record_type: "dossier", official_id: item.officialId,
        source_url: item.sourceUrls[0], source_updated_at: item.sourceUpdatedAt,
        source_hash: item.sourceHash, raw_excerpt: { title: item.title, status: item.statusLabel },
      }, { onConflict: "provider,record_type,official_id,source_hash" });
      if (sourceError) throw sourceError;
      const { error: stepError } = await supabase.from("legislative_steps").upsert(item.steps.map((step, offset) => ({
        official_id: step.officialId, dossier_id: dossierId, chamber: step.chamber, step_code: step.code,
        step_label: step.label, occurred_at: step.occurredAt, sequence: 10_000 + offset,
        source_url: step.sourceUrl, source_updated_at: item.sourceUpdatedAt, source_hash: step.sourceHash,
      })), { onConflict: "official_id" });
      if (stepError) throw stepError;
    }
    await supabase.from("legislative_sync_runs").update({ status: "success", finished_at: new Date().toISOString(), processed_count: parsed.length, details: { inserted, merged } }).eq("id", run.id);
    console.log(`Senate: ${inserted} dossiers inserted, ${merged} cross-chamber dossiers merged.`);
  } catch (error: any) {
    await supabase.from("legislative_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_count: 1, details: { error: error.message } }).eq("id", run.id);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) syncSenate().catch(error => { console.error(error); process.exitCode = 1; });
