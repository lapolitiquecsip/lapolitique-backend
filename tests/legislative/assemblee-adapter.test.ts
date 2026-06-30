import assert from "node:assert/strict";
import test from "node:test";
import { parseAssembleeDossier } from "../../src/lib/legislative/assemblee-adapter.js";

test("extracts official author and chronologically ordered steps from AN open data", () => {
  const parsed = parseAssembleeDossier({ dossierParlementaire: {
    uid: "DLR5L17N50003",
    legislature: "17",
    titreDossier: { titre: "Proposition de loi relative au logement" },
    procedureParlementaire: { libelle: "Proposition de loi ordinaire" },
    initiateur: { acteurs: { acteur: { acteurRef: "PA123" } } },
    actesLegislatifs: { acteLegislatif: {
      uid: "L17-AN1-50003", codeActe: "AN1", organeRef: "PO838901",
      libelleActe: { libelleCourt: "Première lecture" }, dateActe: "2026-06-30T10:00:00+02:00",
      actesLegislatifs: { acteLegislatif: { uid: "L17-DEPOT-50003", codeActe: "AN1-DEPOT", organeRef: "PO838901", libelleActe: { libelleCourt: "Dépôt" }, dateActe: "2026-06-29T10:00:00+02:00" } }
    } }
  } }, new Map([["PA123", "Jeanne Martin"]]));

  assert.equal(parsed?.dossier.authorName, "Jeanne Martin");
  assert.deepEqual(parsed?.steps.map(step => step.label), ["Dépôt", "Première lecture"]);
  assert.equal(parsed?.dossier.statusLabel, "Première lecture");
  assert.equal(parsed?.dossier.currentChamber, "AN");
});

test("rejects dossiers outside the XVII legislature", () => {
  assert.equal(parseAssembleeDossier({ dossierParlementaire: { uid: "DLR5L16N1", legislature: "16" } }, new Map()), null);
});
