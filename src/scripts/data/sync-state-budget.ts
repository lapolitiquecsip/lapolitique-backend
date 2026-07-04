import { OFFICIAL_SOURCES, runIngestion, sha256, upsertInChunks } from "../../lib/data-platform.js";

const source = OFFICIAL_SOURCES.find(item => item.slug === "budget-etat")!;
const endpoint = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/plf-2026-budget-vert/records";
const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const slug = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

await runIngestion({ domain: "state-budget", jobName: "sync-state-budget", source }, async ({ dryRun }) => {
  const records: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(`${endpoint}?limit=100&offset=${offset}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Budget API failed: HTTP ${response.status}`);
    const page = await response.json() as { results?: Record<string, unknown>[] };
    if (!page.results?.length) break;
    records.push(...page.results);
    if (page.results.length < 100) break;
    if (offset > 20_000) throw new Error("Budget API pagination exceeded the safety limit");
  }
  if (!records.length) throw new Error("Budget API returned no records; previous published values were preserved");
  const missions = new Map<string, { name: string; amounts: Record<number, number> }>();
  for (const record of records) {
    const name = String(record.mission ?? record.libelle_mission ?? record.mission_libelle ?? "").trim();
    if (!name) continue;
    const current = missions.get(slug(name)) ?? { name, amounts: { 2024: 0, 2025: 0, 2026: 0 } };
    current.amounts[2024] += numeric(record.execution_2024_cp ?? record.execution_2024 ?? record.cp_2024);
    current.amounts[2025] += numeric(record.lfi_2025_cp_ou_prevision_2025_si_depense_fiscale ?? record.lfi_2025 ?? record.cp_2025);
    current.amounts[2026] += numeric(record.plf_2026_cp_ou_prevision_2026_si_depense_fiscale ?? record.plf_2026 ?? record.cp_2026);
    missions.set(slug(name), current);
  }
  const now = new Date().toISOString();
  const rows = [...missions.entries()].flatMap(([id, mission]) => ([
    { official_id: id, fiscal_year: 2024, name: mission.name, amount: mission.amounts[2024], amount_type: "executed", source_urls: [endpoint], source_updated_at: now, collected_at: now, quality_status: "verified" },
    { official_id: id, fiscal_year: 2025, name: mission.name, amount: mission.amounts[2025], amount_type: "voted", source_urls: [endpoint], source_updated_at: now, collected_at: now, quality_status: "verified" },
    { official_id: id, fiscal_year: 2026, name: mission.name, amount: mission.amounts[2026], amount_type: "project", source_urls: [endpoint], source_updated_at: now, collected_at: now, quality_status: "verified" },
  ])).filter(row => row.amount > 0);
  const contentHash = sha256(JSON.stringify(rows.map(({ collected_at, ...row }) => row)));
  const written = dryRun ? 0 : await upsertInChunks("state_budget_missions", rows, "official_id,fiscal_year,amount_type");
  console.log(`${dryRun ? "Validated" : "Published"} ${rows.length} state budget mission values.`);
  return { result: undefined, rowsRead: records.length, rowsWritten: written, details: { contentHash, fiscalYears: [2024, 2025, 2026] } };
});
