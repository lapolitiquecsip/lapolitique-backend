import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { parse } from "csv-parse";
import { supabase } from "../config/supabase.js";
import { upsertInChunks } from "./data-platform.js";

export interface CatalogResource { id: string; title: string; format: string; url: string; last_modified?: string; filesize?: number; }

export async function getDataGouvDataset(idOrSlug: string) {
  const response = await fetch(`https://www.data.gouv.fr/api/1/datasets/${idOrSlug}/`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`data.gouv.fr dataset ${idOrSlug} failed: HTTP ${response.status}`);
  return response.json() as Promise<{ id: string; title: string; last_modified?: string; resources: CatalogResource[] }>;
}

export async function streamCsv(url: string, options: { delimiter?: string; gzip?: boolean } = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`CSV download failed: HTTP ${response.status} for ${url}`);
  let input: NodeJS.ReadableStream = Readable.fromWeb(response.body as any);
  if (options.gzip || url.endsWith(".gz")) input = input.pipe(createGunzip());
  return input.pipe(parse({ columns: true, delimiter: options.delimiter, bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }));
}

export function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  return normalized && Number.isFinite(Number(normalized)) ? Number(normalized) : null;
}

export function normalizeDepartmentCode(value: unknown) {
  const code = String(value ?? "").trim();
  if (!code) return "";
  if (/^0\d{2}$/.test(code)) return code.slice(1);
  return code.length === 1 ? code.padStart(2, "0") : code;
}

export function indicatorRow(input: { territoryCode: string; indicatorCode: string; domain: string; value: number; unit: string; year: number; sourceId: string; sourceUrl: string; sourceUpdatedAt?: string; methodology?: string; components?: object; quality?: string }) {
  return {
    territory_code: input.territoryCode,
    indicator_code: input.indicatorCode,
    domain: input.domain,
    value: input.value,
    unit: input.unit,
    reference_year: input.year,
    methodology_version: input.methodology ?? "official-v1",
    raw_components: input.components ?? {},
    source_id: input.sourceId,
    source_urls: [input.sourceUrl],
    source_updated_at: input.sourceUpdatedAt ?? new Date().toISOString(),
    collected_at: new Date().toISOString(),
    quality_status: input.quality ?? "verified",
  };
}

export async function publishIndicators(rows: Record<string, unknown>[], dryRun: boolean) {
  if (!rows.length) throw new Error("No valid indicators were produced; previous values were preserved");
  if (dryRun) return 0;
  const codes = [...new Set(rows.map(row => String(row.territory_code)))];
  const known = new Set<string>();
  for (let offset = 0; offset < codes.length; offset += 500) {
    const { data, error } = await supabase.from("territories").select("code").in("code", codes.slice(offset, offset + 500));
    if (error) throw error;
    for (const item of data ?? []) known.add(item.code);
  }
  const eligible = rows.filter(row => known.has(String(row.territory_code)));
  if (!eligible.length) throw new Error("Indicators did not match canonical territories; previous values were preserved");
  return upsertInChunks("territory_indicators", eligible, "territory_code,indicator_code,reference_year,source_id", 500);
}

export function weightedAverage(items: Array<{ value: number; weight: number }>) {
  const valid = items.filter(item => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0);
  const weight = valid.reduce((sum, item) => sum + item.weight, 0);
  return weight ? valid.reduce((sum, item) => sum + item.value * item.weight, 0) / weight : null;
}
