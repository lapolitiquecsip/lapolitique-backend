import { OFFICIAL_SOURCES, runIngestion } from "../../lib/data-platform.js";
import { getDataGouvDataset, indicatorRow, numberValue, publishIndicators, streamCsv } from "../../lib/territorial-source.js";

const source = OFFICIAL_SOURCES.find(item => item.slug === "dgfip-dvf")!;

await runIngestion({ domain: "territories", jobName: "sync-dvf", source }, async ({ sourceId, dryRun }) => {
  const dataset = await getDataGouvDataset("64998de5926530ebcecc7b15");
  const resource = dataset.resources.find(item => /Statistiques totales/i.test(item.title) && item.format === "csv");
  if (!resource) throw new Error("Official aggregate DVF resource was not found");
  const rows: Record<string, unknown>[] = [];
  let read = 0;
  for await (const row of await streamCsv(resource.url)) {
    read++;
    const scale = String(row.echelle_geo ?? "");
    if (!new Set(["commune", "departement", "region"]).has(scale)) continue;
    const value = numberValue(row.med_prix_m2_whole_apt_maison);
    const sales = numberValue(row.nb_ventes_whole_apt_maison);
    if (!row.code_geo || value === null || !sales) continue;
    rows.push(indicatorRow({ territoryCode: String(row.code_geo), indicatorCode: "housing_sale_price_m2", domain: "housing", value, unit: "EUR/m2 median", year: Number(resource.last_modified?.slice(0, 4) ?? new Date().getFullYear()), sourceId: sourceId!, sourceUrl: resource.url, sourceUpdatedAt: resource.last_modified, components: { sales, propertyTypes: ["apartment", "house"], period: "last 10 semesters" }, methodology: "data-gouv-dvf-v1" }));
  }
  const written = await publishIndicators(rows, dryRun);
  console.log(`${dryRun ? "Validated" : "Published"} ${rows.length} DVF price indicators.`);
  return { result: undefined, rowsRead: read, rowsWritten: written, details: { resourceId: resource.id } };
});
