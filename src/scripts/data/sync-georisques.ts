import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { OFFICIAL_SOURCES, runIngestion } from "../../lib/data-platform.js";
import { getDataGouvDataset, publishIndicators } from "../../lib/territorial-source.js";
import { riskIndicators } from "../../lib/territorial-transformers.js";

const source = OFFICIAL_SOURCES.find(item => item.slug === "georisques")!;

await runIngestion({ domain: "territories", jobName: "sync-georisques", source }, async ({ sourceId, dryRun }) => {
  const dataset = await getDataGouvDataset("536995eea3a729239d20486b");
  const resource = dataset.resources.find(item => /GASPAR/i.test(item.title) && /zip|csv/i.test(item.format));
  if (!resource) throw new Error("GASPAR archive was not found");
  const response = await fetch(resource.url.replace(/^http:/, "https:"), { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`GASPAR archive failed: HTTP ${response.status}`);
  const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
  const entry = zip.getEntries().find(item => /^ddrm_risq_.*\.csv$/i.test(item.entryName));
  if (!entry) throw new Error("GASPAR archive has no DDRM risk file");
  const records = parse(entry.getData().toString("latin1"), { columns: true, delimiter: ";", skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
  const year = Number(entry.entryName.match(/20\d{2}/)?.[0] ?? new Date().getFullYear());
  const rows = riskIndicators(records, year, sourceId!, resource.url, resource.last_modified);
  const written = await publishIndicators(rows, dryRun);
  console.log(`${dryRun ? "Validated" : "Published"} ${rows.length} GASPAR risk indicators.`);
  return { result: undefined, rowsRead: records.length, rowsWritten: written, details: { entry: entry.entryName } };
});
