import { indicatorRow, numberValue } from "./territorial-source.js";

const VIOLENCE = new Set(["Homicides", "Violences physiques intrafamiliales", "Violences physiques hors cadre familial", "Violences sexuelles"]);
const THEFT = new Set(["Vols avec armes", "Vols violents sans arme", "Vols sans violence contre des personnes", "Cambriolages de logement", "Vols de véhicules", "Vols dans les véhicules", "Vols d'accessoires sur véhicules"]);

export const isTrackedSecurityIndicator = (value: string) => VIOLENCE.has(value) || THEFT.has(value);

export function aggregateSecurityRows(records: Array<Record<string, string>>, codeField: string, sourceId: string, sourceUrl: string, sourceUpdatedAt?: string) {
  const latestYear = Math.max(...records.map(row => Number(row.annee)).filter(Number.isFinite));
  const grouped = new Map<string, { violence: Record<string, number>; theft: Record<string, number> }>();
  for (const row of records) {
    if (Number(row.annee) !== latestYear || row.est_diffuse === "ndiff") continue;
    const code = String(row[codeField] ?? "").trim();
    const rate = numberValue(row.taux_pour_mille);
    if (!code || rate === null) continue;
    const target = grouped.get(code) ?? { violence: {}, theft: {} };
    if (VIOLENCE.has(row.indicateur)) target.violence[row.indicateur] = rate;
    if (THEFT.has(row.indicateur)) target.theft[row.indicateur] = rate;
    grouped.set(code, target);
  }
  return [...grouped.entries()].flatMap(([code, values]) => {
    const output: Record<string, unknown>[] = [];
    const violence = Object.values(values.violence);
    const theft = Object.values(values.theft);
    if (violence.length) output.push(indicatorRow({ territoryCode: code, indicatorCode: "security_violence_rate", domain: "security", value: Number(violence.reduce((a, b) => a + b, 0).toFixed(3)), unit: "recorded victims per 1000 inhabitants", year: latestYear, sourceId, sourceUrl, sourceUpdatedAt, methodology: "ssmsi-compatible-victims-v1", components: values.violence }));
    if (theft.length) output.push(indicatorRow({ territoryCode: code, indicatorCode: "security_theft_burglary_rate", domain: "security", value: Number(theft.reduce((a, b) => a + b, 0).toFixed(3)), unit: "recorded offences per 1000 inhabitants", year: latestYear, sourceId, sourceUrl, sourceUpdatedAt, methodology: "ssmsi-recorded-offences-v1", components: values.theft }));
    return output;
  });
}

export function riskIndicators(records: Array<Record<string, string>>, year: number, sourceId: string, sourceUrl: string, sourceUpdatedAt?: string) {
  const grouped = new Map<string, Set<string>>();
  for (const row of records) {
    const code = String(row.cod_commune ?? row.code_commune ?? "").trim();
    const risk = String(row.lib_risque ?? row.lib_risque_jo ?? "").trim();
    if (!code || !risk) continue;
    const risks = grouped.get(code) ?? new Set<string>(); risks.add(risk); grouped.set(code, risks);
  }
  return [...grouped.entries()].flatMap(([code, risks]) => {
    const count = risks.size;
    const level = count >= 5 ? 3 : count >= 3 ? 2 : 1;
    return [
      indicatorRow({ territoryCode: code, indicatorCode: "environment_major_risk_count", domain: "environment", value: count, unit: "distinct major risks", year, sourceId, sourceUrl, sourceUpdatedAt, components: { risks: [...risks].sort() } }),
      indicatorRow({ territoryCode: code, indicatorCode: "environment_risk_exposure_level", domain: "environment", value: level, unit: "level 1-3", year, sourceId, sourceUrl, sourceUpdatedAt, methodology: "gaspar-risk-count-v1", components: { distinctRiskCount: count, thresholds: { low: "1-2", medium: "3-4", high: "5+" } } }),
    ];
  });
}

export function atmoAnnualIndicators(observations: Array<{ code: string; date: string; value: number }>, sourceId: string, sourceUrl: string, sourceUpdatedAt?: string) {
  const byCommune = Map.groupBy(observations, item => item.code);
  return [...byCommune.entries()].map(([code, values]) => {
    const latestYear = Math.max(...values.map(item => Number(item.date.slice(0, 4))));
    const annual = values.filter(item => Number(item.date.slice(0, 4)) === latestYear);
    const mean = annual.reduce((sum, item) => sum + item.value, 0) / annual.length;
    return indicatorRow({ territoryCode: code, indicatorCode: "environment_atmo_mean_index", domain: "environment", value: Number(mean.toFixed(2)), unit: "ATMO index 1-6", year: latestYear, sourceId, sourceUrl, sourceUpdatedAt, methodology: "atmo-daily-annual-mean-v1", components: { observedDays: annual.length, officialDailyComposite: true, pollutants: ["NO2", "O3", "PM10", "PM2.5", "SO2"] }, quality: annual.length >= 30 ? "verified" : "partial" });
  });
}
