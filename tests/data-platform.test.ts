import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { OFFICIAL_SOURCES, sha256 } from "../src/lib/data-platform.js";

test("official source registry has stable unique slugs and no generated facts", () => {
  const slugs = OFFICIAL_SOURCES.map(source => source.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.ok(OFFICIAL_SOURCES.every(source => source.datasetUrl.startsWith("https://")));
  assert.ok(OFFICIAL_SOURCES.every(source => source.producer && source.expectedFrequency));
});

test("content hashes are deterministic and distinguish resources", () => {
  assert.equal(sha256("official-record"), sha256(Buffer.from("official-record")));
  assert.notEqual(sha256("official-record"), sha256("changed-record"));
});

test("data platform migration exposes all public contracts and protects editorial review", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20260701_data_platform.sql", import.meta.url), "utf8");
  for (const contract of ["public_territory", "public_territory_indicators", "public_elected_officials", "public_elections", "public_government", "public_state_budget", "public_promises", "public_data_freshness"]) {
    assert.match(sql, new RegExp(`FUNCTION public\\.${contract}\\(`));
  }
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /EXISTS \(SELECT 1 FROM public\.editorial_reviews/);
});
