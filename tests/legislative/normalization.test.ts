import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLegislativeText,
  normalizeDossier,
  promoteFromJorf,
} from "../../src/lib/legislative/normalization.js";

test("classifies official titles with a stable deterministic taxonomy", () => {
  assert.equal(classifyLegislativeText("Projet de loi de finances pour 2027"), "economy_finance");
  assert.equal(classifyLegislativeText("Proposition relative à la protection de l'enfance"), "social_labour");
  assert.equal(classifyLegislativeText("Texte portant diverses dispositions"), "other");
});

test("normalizes an AN dossier without inventing a missing author", () => {
  const dossier = normalizeDossier({
    uid: "DLR5L17N50001",
    title: "Proposition de loi relative au logement",
    procedureLabel: "Proposition de loi ordinaire",
    authorNames: [],
    sourceUrl: "https://www.assemblee-nationale.fr/dyn/17/dossiers/DLR5L17N50001",
    depositedAt: "2026-06-29",
  });

  assert.equal(dossier.authorKind, "parliamentarian");
  assert.equal(dossier.authorName, null);
  assert.equal(dossier.statusCode, "filed");
  assert.equal(dossier.category, "territories_housing");
});

test("only a matching official JORF law promotes a dossier", () => {
  const dossier = normalizeDossier({
    uid: "DLR5L17N50002",
    title: "Projet de loi relatif à la santé",
    procedureLabel: "Projet de loi",
    authorNames: [],
    sourceUrl: "https://www.assemblee-nationale.fr/dyn/17/dossiers/DLR5L17N50002",
  });

  assert.equal(promoteFromJorf(dossier, { nature: "DECRET", nor: "ABCX2600001D", title: dossier.title, publishedAt: "2026-06-30", sourceUrl: "https://legifrance.gouv.fr" }), null);
  const promoted = promoteFromJorf(dossier, { nature: "LOI", nor: "ABCX2600001L", title: dossier.title, publishedAt: "2026-06-30", sourceUrl: "https://legifrance.gouv.fr" });
  assert.equal(promoted?.jorfNor, "ABCX2600001L");
  assert.equal(promoted?.promulgatedAt, "2026-06-30");
});

test("matches a JORF title containing its legal prefix and footnote", () => {
  const dossier = normalizeDossier({
    uid: "DLR5L17N51968",
    title: "Améliorer l'accès au logement des travailleurs des services publics",
    procedureLabel: "Proposition de loi",
    authorNames: [],
    sourceUrl: "https://assemblee-nationale.fr/dossier",
  });
  assert.ok(promoteFromJorf(dossier, {
    nature: "LOI",
    nor: "VLOC2515640L",
    title: "LOI n° 2026-553 du 29 juin 2026 visant à améliorer l'accès au logement des travailleurs des services publics (1)",
    publishedAt: "2026-06-30",
    sourceUrl: "https://legifrance.gouv.fr",
  }));
});
