import assert from "node:assert/strict";
import test from "node:test";
import { buildCommunePopulations, buildOfficialTerritory, buildRegionalFinances, type OddRow } from "../src/lib/territorial-indicators.js";

const row = (variable: string, sous_champ: string, value: string): OddRow => ({ codgeo: "01", libgeo: "Ain", no_indic: "test", variable, sous_champ, A2023: value });

test("maps official ODD values without inventing unavailable indicators", () => {
  const territory = buildOfficialTerritory([
    row("pop", "", "671289"), row("taux_pvt", "total", "10.8"), row("niveau_vie_median", "", "24810"),
    row("esper_vie", "homme", "80.7"), row("esper_vie", "femme", "85.8"),
  ]);
  assert.equal(territory.demographie.populationTotal, 671289);
  assert.equal(territory.economie.revenuMedian, 2068);
  assert.equal(territory.sante.esperanceVie, 83.3);
  assert.equal(territory.logement.prixM2, null);
  assert.match(territory.sources, /Insee\/SDES/);
});

test("computes regional finance ratios from OFGL aggregates", () => {
  const records = [
    ["Dépenses de fonctionnement", 600],
    ["Dépenses d'investissement hors remb", 400],
    ["Encours de dette", 500],
    ["Recettes de fonctionnement", 1000],
  ].map(([agregat, montant]) => ({ reg_code: "84", reg_name: "Test", agregat: String(agregat), montant: Number(montant), ptot: 10 }));
  assert.deepEqual(buildRegionalFinances(records), { budgetHabitant: 100, endettement: 50, investissement: 40 });
});

test("aggregates municipal districts into the Paris commune code", () => {
  const populations = buildCommunePopulations([
    { COM: "75101", Commune: "Paris 1er Arrondissement", DEP: "75", PMUN: "10" },
    { COM: "75102", Commune: "Paris 2e Arrondissement", DEP: "75", PMUN: "20" },
  ]);
  assert.equal(populations["75056"].demographie.populationTotal, 30);
  assert.equal(populations["75056"].populationAggregation, "arrondissements municipaux");
  assert.equal(populations._meta.population.year, 2023);
});
