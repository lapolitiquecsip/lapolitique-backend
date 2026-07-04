import { OFFICIAL_SOURCES, runIngestion } from "../../lib/data-platform.js";
import { getDataGouvDataset, publishIndicators, streamCsv } from "../../lib/territorial-source.js";
import { aggregateSecurityRows, isTrackedSecurityIndicator } from "../../lib/territorial-transformers.js";

const source = OFFICIAL_SOURCES.find(item => item.slug === "ssmsi-delinquance")!;
await runIngestion({ domain: "territories", jobName: "sync-ssmsi", source }, async ({ sourceId, dryRun }) => {
  const dataset = await getDataGouvDataset("621df2954fa5a3b5a023e23c");
  const resources = [
    { resource: dataset.resources.find(item => /^COM -/.test(item.title) && item.format === "csv.gz"), code: "CODGEO_2025", gzip: true },
    { resource: dataset.resources.find(item => /^DEP -/.test(item.title) && item.format === "csv"), code: "Code_departement", gzip: false },
    { resource: dataset.resources.find(item => /^REG -/.test(item.title) && item.format === "csv"), code: "Code_region", gzip: false },
  ];
  const indicators: Record<string, unknown>[] = [];
  let rowsRead = 0;
  for (const item of resources) {
    if (!item.resource) throw new Error("One of the SSMSI commune/department/region resources is missing");
    const records: Record<string, string>[] = [];
    const resourceYear = Number(item.resource.url.match(/data\.gouv-(20\d{2})-/)?.[1] ?? 0);
    for await (const row of await streamCsv(item.resource.url, { delimiter: ";", gzip: item.gzip })) {
      rowsRead++;
      if (resourceYear && Number(row.annee) !== resourceYear) continue;
      if (!isTrackedSecurityIndicator(row.indicateur)) continue;
      records.push(row);
    }
    indicators.push(...aggregateSecurityRows(records, item.code, sourceId!, item.resource.url, item.resource.last_modified));
  }
  const written = await publishIndicators(indicators, dryRun);
  console.log(`${dryRun ? "Validated" : "Published"} ${indicators.length} SSMSI security indicators.`);
  return { result: undefined, rowsRead, rowsWritten: written };
});
