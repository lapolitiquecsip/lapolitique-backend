import { XMLParser } from "fast-xml-parser";
import { OFFICIAL_SOURCES, runIngestion, sha256, upsertInChunks } from "../../lib/data-platform.js";
import { supabase } from "../../config/supabase.js";

const source = { ...OFFICIAL_SOURCES.find(item => item.slug === "budget-etat")!, slug: "dila-government", domain: "government", producer: "DILA", datasetName: "Protocole du Gouvernement", datasetUrl: "https://www.data.gouv.fr/datasets/protocole-du-gouvernement", expectedFrequency: "1 day" };
const text = (value: any): string => typeof value === "string" ? value.trim() : value?.["#text"] ? String(value["#text"]).trim() : "";
const dateFromCompact = (value: string) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

await runIngestion({ domain: "government", jobName: "sync-government", source }, async ({ dryRun }) => {
  const catalogResponse = await fetch("https://www.data.gouv.fr/api/1/datasets/598d7459c751df5a5e67466d/", { signal: AbortSignal.timeout(30_000) });
  if (!catalogResponse.ok) throw new Error(`Government catalog failed: HTTP ${catalogResponse.status}`);
  const catalog = await catalogResponse.json() as { resources: Array<{ url: string; format: string; last_modified?: string }> };
  const resource = catalog.resources.filter(item => item.format?.toLowerCase() === "xml").sort((a, b) => String(b.last_modified).localeCompare(String(a.last_modified)))[0];
  if (!resource) throw new Error("Government XML resource is unavailable");
  const xmlResponse = await fetch(resource.url, { signal: AbortSignal.timeout(60_000) });
  if (!xmlResponse.ok) throw new Error(`Government XML failed: HTTP ${xmlResponse.status}`);
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(await xmlResponse.text());
  const governments = Array.isArray(parsed.Gouvernements?.Gouvernement) ? parsed.Gouvernements.Gouvernement : [parsed.Gouvernements?.Gouvernement].filter(Boolean);
  const latest = governments.sort((a: any, b: any) => String(b["@_date"]).localeCompare(String(a["@_date"])))[0];
  if (!latest?.["@_date"] || !/^\d{8}$/.test(latest["@_date"])) throw new Error("Government XML date is invalid");
  const startedAt = dateFromCompact(latest["@_date"]);
  const ministries = Array.isArray(latest.Ministere) ? latest.Ministere : [latest.Ministere].filter(Boolean);
  const primeMinister = ministries.find((item: any) => text(item.Ministre?.Fonction).toLowerCase() === "premier ministre");
  const governmentId = `government-${latest["@_date"]}`;
  const govRow = { official_id: governmentId, name: text(latest.description) || governmentId, prime_minister: text(primeMinister?.Ministre?.Signataire), started_at: startedAt, ended_at: null, source_urls: [resource.url], source_updated_at: resource.last_modified ?? new Date().toISOString(), collected_at: new Date().toISOString() };
  const ministryRows = ministries.map((item: any) => ({ official_id: String(item["@_id"] || `ministry-${sha256(text(item.Nom)).slice(0, 20)}`), name: text(item.Nom), source_urls: [resource.url], source_updated_at: resource.last_modified ?? new Date().toISOString(), collected_at: new Date().toISOString() })).filter(item => item.name);
  let written = 0;
  if (!dryRun) {
    const { data: government, error: governmentError } = await supabase.from("governments").upsert(govRow, { onConflict: "official_id" }).select("id").single();
    if (governmentError) throw governmentError;
    written += 1 + await upsertInChunks("ministries", ministryRows, "official_id");
    const { data: storedMinistries, error: ministryError } = await supabase.from("ministries").select("id,official_id").in("official_id", ministryRows.map(item => item.official_id));
    if (ministryError) throw ministryError;
    const ministryIds = new Map((storedMinistries ?? []).map(item => [item.official_id, item.id]));
    const memberRows = ministries.flatMap((item: any, rank: number) => {
      const ministers = Array.isArray(item.Ministre) ? item.Ministre : [item.Ministre].filter(Boolean);
      return ministers.map((minister: any, subRank: number) => ({ official_id: `${governmentId}:${String(item["@_id"] || rank)}:${subRank}`, government_id: government.id, ministry_id: ministryIds.get(String(item["@_id"])) ?? null, first_name: "", last_name: text(minister.Signataire), title: text(minister.Fonction), rank: rank * 10 + subRank, started_at: startedAt, ended_at: null, source_urls: [resource.url], source_updated_at: resource.last_modified ?? new Date().toISOString(), collected_at: new Date().toISOString() })).filter((member: any) => member.last_name && member.title);
    });
    written += await upsertInChunks("government_members", memberRows, "official_id");
  }
  console.log(`${dryRun ? "Validated" : "Published"} government ${governmentId} with ${ministries.length} ministries.`);
  return { result: undefined, rowsRead: ministries.length + 1, rowsWritten: written, details: { resource: resource.url, startedAt } };
});
