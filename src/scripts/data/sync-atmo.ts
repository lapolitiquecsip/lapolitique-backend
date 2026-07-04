import { OFFICIAL_SOURCES, runIngestion } from "../../lib/data-platform.js";
import { getDataGouvDataset, numberValue, publishIndicators, streamCsv } from "../../lib/territorial-source.js";
import { atmoAnnualIndicators } from "../../lib/territorial-transformers.js";

const source = OFFICIAL_SOURCES.find(item => item.slug === "atmo-index")!;

await runIngestion({ domain: "territories", jobName: "sync-atmo", source }, async ({ sourceId, dryRun }) => {
  const dataset = await getDataGouvDataset("6149925a2ff0ab6cebdd6fe8");
  const resource = dataset.resources.find(item => /\(csv\)/i.test(item.title) && item.format === "csv");
  if (!resource) throw new Error("National ATMO CSV resource was not found");
  const daily = new Map<string, { code: string; date: string; value: number; updated: string; components: object }>();
  let rowsRead = 0;
  for await (const row of await streamCsv(resource.url)) {
    rowsRead++;
    if (row.type_zone !== "commune") continue;
    const code = String(row.code_zone ?? "").trim();
    const date = String(row.date_ech ?? "").slice(0, 10);
    const value = numberValue(row.code_qual);
    if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(date) || value === null || value <= 0) continue;
    const key = `${code}:${date}`;
    const candidate = { code, date, value, updated: String(row.date_maj ?? ""), components: { no2: numberValue(row.code_no2), o3: numberValue(row.code_o3), pm10: numberValue(row.code_pm10), pm25: numberValue(row.code_pm25), so2: numberValue(row.code_so2), label: row.lib_qual } };
    if (!daily.has(key) || candidate.updated > daily.get(key)!.updated) daily.set(key, candidate);
  }
  const rows = atmoAnnualIndicators([...daily.values()], sourceId!, resource.url, resource.last_modified);
  const written = await publishIndicators(rows, dryRun);
  console.log(`${dryRun ? "Validated" : "Published"} ${rows.length} annual ATMO commune indicators.`);
  return { result: undefined, rowsRead, rowsWritten: written, details: { dailyObservations: daily.size } };
});
