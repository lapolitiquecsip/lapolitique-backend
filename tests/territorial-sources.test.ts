import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDepartmentCode, numberValue, weightedAverage } from "../src/lib/territorial-source.js";
import { aggregateSecurityRows, atmoAnnualIndicators, riskIndicators } from "../src/lib/territorial-transformers.js";

test("normalizes official numeric and department formats", () => {
  assert.equal(numberValue("1 234,50"), 1234.5);
  assert.equal(numberValue("NA"), null);
  assert.equal(normalizeDepartmentCode("005"), "05");
  assert.equal(normalizeDepartmentCode("2A"), "2A");
  assert.equal(normalizeDepartmentCode("971"), "971");
  assert.equal(weightedAverage([{ value: 2, weight: 1 }, { value: 4, weight: 3 }]), 3.5);
});

test("SSMSI aggregation uses latest published year and excludes suppressed rows", () => {
  const rows = aggregateSecurityRows([
    { code: "01", annee: "2024", indicateur: "Homicides", taux_pour_mille: "9", est_diffuse: "diff" },
    { code: "01", annee: "2025", indicateur: "Homicides", taux_pour_mille: "0,1", est_diffuse: "diff" },
    { code: "01", annee: "2025", indicateur: "Violences sexuelles", taux_pour_mille: "1,2", est_diffuse: "diff" },
    { code: "01", annee: "2025", indicateur: "Cambriolages de logement", taux_pour_mille: "3,4", est_diffuse: "diff" },
    { code: "02", annee: "2025", indicateur: "Homicides", taux_pour_mille: "5", est_diffuse: "ndiff" },
  ], "code", "source", "https://example.test");
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.indicator_code === "security_violence_rate")?.value, 1.3);
  assert.equal(rows.find(row => row.indicator_code === "security_theft_burglary_rate")?.value, 3.4);
});

test("GASPAR risk level is deterministic and retains raw risk labels", () => {
  const rows = riskIndicators([
    { cod_commune: "01001", lib_risque: "Inondation" },
    { cod_commune: "01001", lib_risque: "Séisme" },
    { cod_commune: "01001", lib_risque: "Feu de forêt" },
    { cod_commune: "01001", lib_risque: "Inondation" },
  ], 2026, "source", "https://example.test");
  assert.equal(rows.find(row => row.indicator_code === "environment_major_risk_count")?.value, 3);
  assert.equal(rows.find(row => row.indicator_code === "environment_risk_exposure_level")?.value, 2);
});

test("ATMO annual indicator only averages the latest year", () => {
  const [row] = atmoAnnualIndicators([
    { code: "01001", date: "2025-12-31", value: 6 },
    { code: "01001", date: "2026-01-01", value: 2 },
    { code: "01001", date: "2026-01-02", value: 4 },
  ], "source", "https://example.test");
  assert.equal(row.reference_year, 2026);
  assert.equal(row.value, 3);
  assert.equal(row.quality_status, "partial");
});
