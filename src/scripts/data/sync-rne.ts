import { parse } from "csv-parse/sync";
import { OFFICIAL_SOURCES, runIngestion, sha256, upsertInChunks } from "../../lib/data-platform.js";

interface DataGouvResource { id: string; title?: string; url: string; format?: string; last_modified?: string; }
const source = OFFICIAL_SOURCES.find(item => item.slug === "rne")!;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const get = (row: Record<string, string>, ...candidates: string[]) => {
  const entries = Object.entries(row);
  for (const candidate of candidates) {
    const found = entries.find(([key]) => normalize(key) === normalize(candidate));
    if (found?.[1]?.trim()) return found[1].trim();
  }
  return "";
};
const isoDate = (value: string) => {
  if (!value) return null;
  const parts = value.split(/[\/-]/);
  if (parts.length === 3 && parts[0].length <= 2) return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
};
const classify = (title: string) => {
  const value = normalize(title);
  if (value.includes("conseillers municipaux")) return "municipal_councillor";
  if (value.includes("maires")) return "mayor";
  if (value.includes("communautaires")) return "community_councillor";
  if (value.includes("departementaux")) return "departmental_councillor";
  if (value.includes("regionaux")) return "regional_councillor";
  return null;
};

await runIngestion({ domain: "officials", jobName: "sync-rne", source }, async ({ sourceId, dryRun }) => {
  const response = await fetch("https://www.data.gouv.fr/api/1/datasets/repertoire-national-des-elus-1/", { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`RNE catalog lookup failed: HTTP ${response.status}`);
  const dataset = await response.json() as { resources: DataGouvResource[] };
  const candidates = dataset.resources.filter(resource => resource.url && (resource.format?.toLowerCase() === "csv" || resource.url.toLowerCase().includes(".csv"))).map(resource => ({ ...resource, mandateType: classify(resource.title ?? "") })).filter(resource => resource.mandateType);
  const latest = [...Map.groupBy(candidates, resource => resource.mandateType!).entries()].map(([, resources]) => resources.sort((a, b) => String(b.last_modified).localeCompare(String(a.last_modified)))[0]);
  if (!latest.length) throw new Error("No recognized RNE CSV resources found; catalog schema may have changed");
  const people = new Map<string, Record<string, unknown>>();
  const mandates = new Map<string, Record<string, unknown>>();
  let rowsRead = 0;
  let rejected = 0;
  const now = new Date().toISOString();
  for (const resource of latest) {
    const download = await fetch(resource.url, { signal: AbortSignal.timeout(5 * 60_000) });
    if (!download.ok) throw new Error(`RNE resource ${resource.id} failed: HTTP ${download.status}`);
    const rows = parse(Buffer.from(await download.arrayBuffer()), { columns: true, delimiter: [";", ","], bom: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
    rowsRead += rows.length;
    for (const row of rows) {
      const lastName = get(row, "Nom de l'élu", "Nom", "Nom usuel");
      const firstName = get(row, "Prénom de l'élu", "Prénom", "Prénom usuel");
      const birthDate = isoDate(get(row, "Date de naissance"));
      const commune = get(row, "Code de la commune", "Code commune");
      const department = get(row, "Code du département", "Code département");
      const region = get(row, "Code de la région", "Code région");
      const territoryCode = resource.mandateType === "regional_councillor" ? region : resource.mandateType === "departmental_councillor" ? department : commune;
      if (!lastName || !firstName || !territoryCode) { rejected++; continue; }
      const personId = `rne-person-${sha256([normalize(lastName), normalize(firstName), birthDate ?? ""].join("|")).slice(0, 24)}`;
      const startedAt = isoDate(get(row, "Date de début du mandat", "Date de début de mandat"));
      const mandateId = `rne-mandate-${sha256([personId, resource.mandateType!, territoryCode, startedAt ?? ""].join("|")).slice(0, 24)}`;
      people.set(personId, { official_id: personId, first_name: firstName, last_name: lastName, sex: get(row, "Code sexe", "Sexe") || null, birth_date: birthDate, source_id: sourceId, source_urls: [resource.url], source_updated_at: resource.last_modified ?? now, collected_at: now, quality_status: "verified" });
      mandates.set(mandateId, { official_id: mandateId, official_id_person: personId, mandate_type: resource.mandateType, territory_code: territoryCode, institution: get(row, "Libellé de la collectivité", "Libellé de la commune", "Nom de la commune") || null, group_name: get(row, "Libellé de la nuance politique", "Groupe politique") || null, started_at: startedAt, ended_at: null, source_id: sourceId, source_updated_at: resource.last_modified ?? now, collected_at: now });
    }
  }
  let written = 0;
  if (!dryRun) {
    written += await upsertInChunks("elected_officials", [...people.values()], "official_id");
    written += await upsertInChunks("elected_mandates", [...mandates.values()], "official_id");
  }
  console.log(`${dryRun ? "Validated" : "Published"} ${people.size} RNE officials and ${mandates.size} mandates; ${rejected} rows rejected.`);
  return { result: undefined, rowsRead, rowsWritten: written, rowsRejected: rejected, details: { resources: latest.map(item => item.id) } };
});
