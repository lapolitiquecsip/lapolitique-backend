import assert from "node:assert/strict";
import test from "node:test";
import { parseAmeliDump } from "../../src/lib/legislative/ameli-adapter.js";

async function* lines() {
  yield "COPY amd (id, subid, amdperid, motid, etaid, nomentid, sorid, avcid, avgid, irrid, txtid, opmid, ocmid, ideid, discomid, num, rev, typ, dis, obj, datdep, obs) FROM stdin;";
  yield "1\t\\N\t\\N\t\\N\t1\t1\tA\t\\N\t\\N\t\\N\t9\t\\N\t\\N\t\\N\t\\N\t42\t0\tA\tDispositif\tObjet\t2026-06-30 10:00:00\t\\N";
  yield "\\.";
  yield "COPY amdsen (amdid, senid, rng, qua, nomuse, prenomuse, hom, grpid) FROM stdin;";
  yield "1\t5\t1\tMme\tMartin\tJeanne\tN\t3";
  yield "\\.";
  yield "COPY sor (id, lib, cod, typ) FROM stdin;";
  yield "A\tAdopté\tADO\tS";
  yield "\\.";
  yield 'COPY txt_ameli (id, natid, lecid, sesinsid, sesdepid, fbuid, num, "int", inl, datdep, urg, dis, secdel, loifin, loifinpar, txtamd, datado, numado, txtexa, pubdellim, numabs, libdelim, libcplnat, doslegsignet) FROM stdin;';
  yield "9\t1\t1\t\\N\t1\t\\N\t790\tTitre\tTitre long\t2026-06-20 10:00:00\tN\tO\tN\tN\t0\tN\t\\N\t\\N\tN\t\\N\t\\N\t\\N\t\\N\tppl25-790";
  yield "\\.";
}

test("streams recent Senate amendments from the official AMELI dump", async () => {
  const records = await parseAmeliDump(lines());
  assert.equal(records.length, 1);
  assert.equal(records[0].signet, "ppl25-790");
  assert.equal(records[0].authorName, "Mme Jeanne Martin");
  assert.equal(records[0].outcomeCode, "adopted");
});
