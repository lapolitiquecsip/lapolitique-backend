import { OFFICIAL_SOURCES, runIngestion } from "../../lib/data-platform.js";
import { indicatorRow, normalizeDepartmentCode, numberValue, publishIndicators } from "../../lib/territorial-source.js";

const source = OFFICIAL_SOURCES.find(item => item.slug === "depp-bac")!;
const endpoint = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-baccalaureat-par-departement/records";

await runIngestion({ domain: "territories", jobName: "sync-depp-bac", source }, async ({ sourceId, dryRun }) => {
  const all: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(`${endpoint}?limit=100&offset=${offset}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`DEPP API failed: HTTP ${response.status}`);
    const page = await response.json() as { results?: any[] };
    if (!page.results?.length) break;
    all.push(...page.results);
    if (page.results.length < 100) break;
  }
  const latestYear = Math.max(...all.map(row => Number(row.session)).filter(Number.isFinite));
  const grouped = Map.groupBy(all.filter(row => Number(row.session) === latestYear), row => normalizeDepartmentCode(row.code_departement));
  const rows: Record<string, unknown>[] = [];
  for (const [code, records] of grouped) {
    const present = records.reduce((sum, row) => sum + (numberValue(row.nombre_de_presents_a_l_examen) ?? 0), 0);
    const admitted = records.reduce((sum, row) => sum + (numberValue(row.nombre_d_admis_a_l_examen) ?? 0), 0);
    if (!code || !present) continue;
    rows.push(indicatorRow({ territoryCode: code, indicatorCode: "education_bac_success", domain: "education", value: Number((100 * admitted / present).toFixed(2)), unit: "%", year: latestYear, sourceId: sourceId!, sourceUrl: endpoint, components: { present, admitted, aggregation: "all pathways and genders" } }));
  }
  const written = await publishIndicators(rows, dryRun);
  console.log(`${dryRun ? "Validated" : "Published"} ${rows.length} DEPP baccalaureate indicators (${latestYear}).`);
  return { result: undefined, rowsRead: all.length, rowsWritten: written, details: { year: latestYear } };
});
