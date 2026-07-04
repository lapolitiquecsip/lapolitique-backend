import assert from "node:assert/strict";
import test from "node:test";
import { selectJorfArchiveUrls } from "../../src/lib/legislative/jorf-archives.js";

const directory = `
  <a href="JORFSIMPLE_20251231-220000.tar.gz">old</a>
  <a href="JORFSIMPLE_20260101-003004.tar.gz">first</a>
  <a href="JORFSIMPLE_20260101-220000.tar.gz">first update</a>
  <a href="JORFSIMPLE_20260630-220000.tar.gz">latest</a>
  <a href="JORFSIMPLE_20260701-003000.tar.gz">future</a>
`;

test("selects every archive in a requested calendar year up to the cutoff", () => {
  assert.deepEqual(selectJorfArchiveUrls(directory, "https://dila.test/", { year: 2026, through: "2026-06-30" }), [
    "https://dila.test/JORFSIMPLE_20260101-003004.tar.gz",
    "https://dila.test/JORFSIMPLE_20260101-220000.tar.gz",
    "https://dila.test/JORFSIMPLE_20260630-220000.tar.gz",
  ]);
});

test("selects only the latest archive when no year is requested", () => {
  assert.deepEqual(selectJorfArchiveUrls(directory, "https://dila.test/"), [
    "https://dila.test/JORFSIMPLE_20260701-003000.tar.gz",
  ]);
});
