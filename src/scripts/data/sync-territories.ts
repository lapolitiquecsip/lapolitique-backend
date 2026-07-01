import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OFFICIAL_SOURCES, runIngestion, upsertInChunks } from "../../lib/data-platform.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files = {
  department: JSON.parse(fs.readFileSync(path.join(root, "src/data/departments_indicators.json"), "utf8")),
  region: JSON.parse(fs.readFileSync(path.join(root, "src/data/regions_indicators.json"), "utf8")),
  commune: JSON.parse(fs.readFileSync(path.join(root, "src/data/communes_indicators.json"), "utf8")),
} as Record<string, Record<string, any>>;
const source = OFFICIAL_SOURCES.find(item => item.slug === "insee-local")!;
const domainBySection: Record<string, string> = { demographie: "demography", economie: "economy", education: "education", sante: "health", securite: "security", logement: "housing", finances: "finance", environnement: "environment" };
const unitByIndicator: Record<string, string> = { populationTotal: "inhabitants", densite: "inhabitants/km2", evolution10ans: "%", moins25ans: "%", plus65ans: "%", chomage: "%", revenuMedian: "EUR/month", pauvrete: "%", bac: "%", diplomesSup: "%", decrochage: "%", medecins10k: "per 10000 inhabitants", scoreAPL: "consultations/year", esperanceVie: "years", atteintesPersonnes: "per 1000 inhabitants", atteintesBiens: "per 1000 inhabitants", prixM2: "EUR/m2", logementsSociaux: "%", proprietaires: "%", budgetHabitant: "EUR/inhabitant", endettement: "%", investissement: "%", qualiteAir: "index", surfaceNaturelle: "%", risques: "index" };

await runIngestion({ domain: "territories", jobName: "sync-territories", source }, async ({ sourceId, dryRun }) => {
  const now = new Date().toISOString();
  const territories: Record<string, unknown>[] = [];
  const indicators: Record<string, unknown>[] = [];
  for (const [type, records] of Object.entries(files)) for (const [code, record] of Object.entries(records)) {
    if (code === "_meta") continue;
    territories.push({ code, official_id: `cog:${type}:${code}`, type, name: record.name ?? code, source_id: sourceId, source_updated_at: now, collected_at: now, quality_status: "verified" });
    for (const [section, values] of Object.entries(record)) {
      if (!domainBySection[section] || !values || typeof values !== "object") continue;
      for (const [indicator, value] of Object.entries(values as Record<string, unknown>)) {
        if (value === null || typeof value !== "number") continue;
        const provenanceYears = record.provenance?.years ?? {};
        const year = Number(Object.values(provenanceYears).find(Boolean) ?? (type === "commune" ? 2023 : 2024));
        indicators.push({ territory_code: code, indicator_code: indicator, domain: domainBySection[section], value, unit: unitByIndicator[indicator] ?? "value", reference_year: year, methodology_version: indicator === "qualiteAir" || indicator === "risques" ? "composite-v1" : "official-v1", raw_components: {}, source_id: sourceId, source_urls: [record.provenance?.url ?? source.datasetUrl], source_updated_at: now, collected_at: now, quality_status: "verified" });
      }
    }
  }
  let written = 0;
  if (!dryRun) {
    written += await upsertInChunks("territories", territories, "code");
    written += await upsertInChunks("territory_indicators", indicators, "territory_code,indicator_code,reference_year,source_id");
  }
  console.log(`${dryRun ? "Validated" : "Published"} ${territories.length} territories and ${indicators.length} indicators.`);
  return { result: undefined, rowsRead: territories.length + indicators.length, rowsWritten: written };
});
