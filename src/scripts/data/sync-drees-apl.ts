import ExcelJS from "exceljs";
import { OFFICIAL_SOURCES, runIngestion } from "../../lib/data-platform.js";
import { getDataGouvDataset, indicatorRow, numberValue, publishIndicators } from "../../lib/territorial-source.js";

const source = OFFICIAL_SOURCES.find(item => item.slug === "drees-apl")!;

await runIngestion({ domain: "territories", jobName: "sync-drees-apl", source }, async ({ sourceId, dryRun }) => {
  const dataset = await getDataGouvDataset("62263314072c63d4d53e0c4e");
  const resource = dataset.resources.filter(item => /médecins généralistes/i.test(item.title) && /sheet|xlsx/i.test(item.format)).sort((a, b) => String(b.last_modified).localeCompare(String(a.last_modified)))[0];
  if (!resource) throw new Error("DREES APL physicians workbook was not found");
  const response = await fetch(resource.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`DREES APL workbook failed: HTTP ${response.status}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as any);
  const sheets = workbook.worksheets.filter(sheet => /^APL \d{4}$/.test(sheet.name)).sort((a, b) => b.name.localeCompare(a.name));
  const sheet = sheets[0];
  if (!sheet) throw new Error("DREES workbook contains no annual APL sheet");
  const year = Number(sheet.name.match(/\d{4}/)![0]);
  const rows: Record<string, unknown>[] = [];
  let rejected = 0;
  for (let index = 11; index <= sheet.rowCount; index++) {
    const values = sheet.getRow(index).values as any[];
    const code = String(values[1] ?? "").trim().padStart(5, "0");
    const apl = numberValue(values[3]);
    const population = numberValue(values[8]);
    if (!/^\d{5}$|^2[AB]\d{3}$/.test(code) || apl === null) { rejected++; continue; }
    rows.push(indicatorRow({ territoryCode: code, indicatorCode: "health_apl_gp", domain: "health", value: apl, unit: "consultations/year/standardized inhabitant", year, sourceId: sourceId!, sourceUrl: resource.url, sourceUpdatedAt: resource.last_modified, components: { population, profession: "general_practitioners" } }));
  }
  const written = await publishIndicators(rows, dryRun);
  console.log(`${dryRun ? "Validated" : "Published"} ${rows.length} DREES APL indicators (${year}).`);
  return { result: undefined, rowsRead: sheet.rowCount - 10, rowsWritten: written, rowsRejected: rejected, details: { resourceId: resource.id, year } };
});
