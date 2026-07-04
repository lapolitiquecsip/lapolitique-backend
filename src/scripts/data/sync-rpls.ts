import ExcelJS from "exceljs";
import { OFFICIAL_SOURCES, runIngestion } from "../../lib/data-platform.js";
import { indicatorRow, numberValue, publishIndicators } from "../../lib/territorial-source.js";

const source = OFFICIAL_SOURCES.find(item => item.slug === "sdes-rpls")!;
const resourceUrl = "https://www.statistiques.developpement-durable.gouv.fr/media/7970/download?inline";

await runIngestion({ domain: "territories", jobName: "sync-rpls", source }, async ({ sourceId, dryRun }) => {
  const response = await fetch(resourceUrl, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!response.ok) throw new Error(`National RPLS workbook failed: HTTP ${response.status}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as any);
  const configurations = [
    { sheet: "REGION", codeHeader: "REG" },
    { sheet: "DEPARTEMENT", codeHeader: "DEP" },
    { sheet: "COMMUNES", codeHeader: "DEPCOM_ARM" },
  ];
  const rows: Record<string, unknown>[] = [];
  let rowsRead = 0;
  for (const configuration of configurations) {
    const sheet = workbook.getWorksheet(configuration.sheet);
    if (!sheet) throw new Error(`RPLS workbook is missing ${configuration.sheet}`);
    const headers = sheet.getRow(6).values as any[];
    const codeColumn = headers.findIndex(value => String(value ?? "") === configuration.codeHeader);
    const densityColumn = headers.findIndex(value => String(value ?? "") === "densite");
    const stockColumn = headers.findIndex(value => String(value ?? "") === "nb_ls");
    if (codeColumn < 1 || densityColumn < 1) throw new Error(`RPLS ${configuration.sheet} schema changed`);
    for (let index = 7; index <= sheet.rowCount; index++) {
      rowsRead++;
      const values = sheet.getRow(index).values as any[];
      const code = String(values[codeColumn] ?? "").trim();
      const density = numberValue(values[densityColumn]);
      const stock = numberValue(values[stockColumn]);
      if (!code || density === null) continue;
      rows.push(indicatorRow({ territoryCode: code, indicatorCode: "housing_social_share", domain: "housing", value: density, unit: "% primary residences", year: 2024, sourceId: sourceId!, sourceUrl: resourceUrl, components: { socialHousingStock: stock, field: "RPLS decree scope", publishedAt: "2024-12-20" }, methodology: "sdes-rpls-density-v1" }));
    }
  }
  const written = await publishIndicators(rows, dryRun);
  console.log(`${dryRun ? "Validated" : "Published"} ${rows.length} RPLS 2024 social-housing indicators.`);
  return { result: undefined, rowsRead, rowsWritten: written, details: { referenceYear: 2024, sheets: configurations.map(item => item.sheet) } };
});
