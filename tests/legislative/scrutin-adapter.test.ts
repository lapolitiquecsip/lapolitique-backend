import assert from "node:assert/strict";
import test from "node:test";
import { parseAssembleeScrutin } from "../../src/lib/legislative/scrutin-adapter.js";

test("links an amendment vote to its dossier and preserves official counts", () => {
  const parsed = parseAssembleeScrutin({ scrutin: {
    uid: "VTANR5L17V5000", legislature: "17", dateScrutin: "2026-06-30",
    titre: "l'amendement n° 42 au projet de loi de finances pour 2027",
    objet: { libelle: "l'amendement n° 42 au projet de loi de finances pour 2027" },
    sort: { code: "adopté", libelle: "adopté" },
    syntheseVote: { decompte: { pour: "120", contre: "80", abstentions: "4" } },
    ventilationVotes: { organe: { groupes: { groupe: [] } } }
  } }, [{ id: "d1", officialId: "DLR5L17N1", title: "Projet de loi de finances pour 2027" }], new Map());
  assert.equal(parsed?.scrutin.dossierId, "d1");
  assert.equal(parsed?.amendment?.number, "42");
  assert.equal(parsed?.amendment?.outcomeCode, "adopted");
  assert.equal(parsed?.scrutin.forCount, 120);
});
