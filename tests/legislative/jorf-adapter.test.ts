import assert from "node:assert/strict";
import test from "node:test";
import { parseJorfXml } from "../../src/lib/legislative/jorf-adapter.js";

test("accepts official JORF laws and rejects decrees", () => {
  const law = parseJorfXml(`<TEXTE><ID>JORFTEXT1</ID><ID_ELI>https://legifrance/eli/loi/1</ID_ELI><NATURE>LOI</NATURE><NOR>TEST2600001L</NOR><DATE_PUBLI>2026-06-30</DATE_PUBLI><TITREFULL>LOI visant à améliorer le logement</TITREFULL></TEXTE>`);
  assert.equal(law?.nor, "TEST2600001L");
  assert.equal(parseJorfXml(`<TEXTE><NATURE>DECRET</NATURE></TEXTE>`), null);
});
