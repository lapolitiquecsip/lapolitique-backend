import assert from "node:assert/strict";
import test from "node:test";
import { parseSenateText } from "../../src/lib/legislative/senate-adapter.js";

test("extracts official Senate identity, author and workflow", () => {
  const parsed = parseSenateText(`<akomaNtoso><bill name="ppl"><meta><identification><FRBRWork><FRBRalias name="signet-dossier-legislatif-senat" value="ppl25-790"/><FRBRalias name="url-senat" value="https://www.senat.fr/dossier-legislatif/ppl25-790.html"/><FRBRauthor href="#author" as="#auteur"/></FRBRWork></identification><workflow><step date="2026-06-25" outcome="déposé au Sénat" eId="step1"/></workflow><references><TLCPerson showAs="Mme Jeanne Martin" eId="author"/></references></meta><preamble><docTitle>Proposition de loi relative à la santé</docTitle></preamble></bill></akomaNtoso>`, "2026-06-29T10:00:00Z");
  assert.equal(parsed?.officialId, "SENAT:ppl25-790");
  assert.equal(parsed?.authorName, "Mme Jeanne Martin");
  assert.equal(parsed?.steps[0].chamber, "SENAT");
});
