import assert from "node:assert/strict";
import test from "node:test";
import { buildOfficialTerritory, type OddRow } from "../src/lib/territorial-indicators.js";

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
