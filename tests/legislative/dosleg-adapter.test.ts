import assert from "node:assert/strict";
import test from "node:test";
import { parseDoslegDump } from "../../src/lib/legislative/dosleg-adapter.js";

async function* lines() {
  yield "COPY auteur (autcod, quacod, typautcod, nomuse, prenom, nomtec, autmat, grpapp) FROM stdin;";
  yield "1\tM.\tS\tMartin\tJean\t\\N\tABC123\tSOC"; yield "\\.";
  yield "COPY posvot (posvotcod, posvotlib) FROM stdin;";
  yield "P\tPour"; yield "\\.";
  yield "COPY scr (sesann, scrnum, code, scrint, scrdat, scrpou, scrcon, scrvot, scrsuf, scrvotsea, scrsufsea, scrpousea, scrconsea, scrmaj, scrmajsea, soslib) FROM stdin;";
  yield "2025\t10\tX\tProjet de loi relatif au logement\t2026-06-30\t200\t100\t310\t300\t0\t0\t0\t0\t0\t0\tAdopté"; yield "\\.";
  yield "COPY corscr (sesann, scrnum, corscrord, corscrtxt, corscrurl) FROM stdin;";
  yield "2025\t10\t1\tTexte\thttps://senat.fr/scrutin/10.html"; yield "\\.";
  yield "COPY votsen (sesann, scrnum, senmat, posvotcod, titsencod, stavotidt, senmatdel, votsenmar) FROM stdin;";
  yield "2025\t10\tABC123\tP\tS\t1\t\\N\tN"; yield "\\.";
}

test("streams Senate public scrutin counts and nominative votes", async () => {
  const records = await parseDoslegDump(lines());
  assert.equal(records[0].forCount, 200);
  assert.equal(records[0].abstainCount, 10);
  assert.equal(records[0].votes[0].voterName, "Jean Martin");
  assert.equal(records[0].votes[0].position, "for");
});
