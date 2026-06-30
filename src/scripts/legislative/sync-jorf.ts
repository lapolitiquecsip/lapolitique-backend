import "dotenv/config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "tar";
import { supabase } from "../../config/supabase.js";
import { parseJorfXml } from "../../lib/legislative/jorf-adapter.js";
import { promoteFromJorf, stableHash, type NormalizedDossier } from "../../lib/legislative/normalization.js";

const DIRECTORY_URL = "https://echanges.dila.gouv.fr/OPENDATA/JORFSIMPLE/";

async function latestArchiveUrl() {
  const response = await fetch(DIRECTORY_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`DILA archive index HTTP ${response.status}`);
  const matches = [...(await response.text()).matchAll(/href="(JORFSIMPLE_\d{8}-\d{6}\.tar\.gz)"/g)].map(match => match[1]);
  const latest = matches.sort().at(-1);
  if (!latest) throw new Error("No JORFSIMPLE archive found in the DILA directory");
  return new URL(latest, DIRECTORY_URL).toString();
}

async function xmlFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return xmlFiles(candidate);
    return /^JORFTEXT.*\.xml$/.test(entry.name) ? [candidate] : [];
  }));
  return nested.flat();
}

export async function syncJorf() {
  const { data: run, error: runError } = await supabase.from("legislative_sync_runs").insert({ pipeline: "jorf", status: "running" }).select("id").single();
  if (runError) throw runError;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "lapolitique-jorf-"));
  try {
    const archiveUrl = await latestArchiveUrl();
    const archive = path.join(temp, "jorf.tar.gz");
    const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`DILA archive HTTP ${response.status}`);
    await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()));
    await extract({ file: archive, cwd: temp, filter: entryPath => /JORFTEXT.*\.xml$/.test(entryPath) });
    const records = (await Promise.all((await xmlFiles(temp)).map(async file => parseJorfXml(await fs.readFile(file, "utf8"))))).filter((record): record is NonNullable<typeof record> => record !== null);

    const { data: rows, error: dossierError } = await supabase.from("legislative_dossiers").select("*").eq("legislature", 17);
    if (dossierError) throw dossierError;
    const dossiers: Array<NormalizedDossier & { id: string }> = (rows ?? []).map(row => ({
      id: row.id,
      officialId: row.official_id,
      legislature: row.legislature,
      title: row.title,
      textType: row.text_type,
      authorKind: row.author_kind,
      authorName: row.author_name,
      category: row.category,
      statusCode: row.status_code,
      statusLabel: row.status_label,
      currentChamber: row.current_chamber,
      depositedAt: row.deposited_at,
      sourceUrls: row.source_urls,
      sourceUpdatedAt: row.source_updated_at,
      sourceHash: row.source_hash,
    }));

    let promotedCount = 0;
    for (const record of records) {
      const match = dossiers.map(dossier => ({ dossier, promotion: promoteFromJorf(dossier, record) })).find(value => value.promotion);
      await supabase.from("legislative_source_records").upsert({ provider: "DILA", record_type: "jorf_law", official_id: record.jorfId, source_url: record.sourceUrl, source_updated_at: record.publishedAt, source_hash: stableHash(record), raw_excerpt: record }, { onConflict: "provider,record_type,official_id,source_hash" });
      if (!match?.promotion) continue;
      const promotion = match.promotion;
      const { error } = await supabase.from("promulgated_laws").upsert({
        dossier_id: match.dossier.id,
        jorf_id: record.jorfId,
        nor: promotion.jorfNor,
        title: promotion.title,
        promulgated_at: promotion.promulgatedAt,
        eli_url: record.eli,
        source_url: promotion.sourceUrl,
        source_updated_at: new Date().toISOString(),
        source_hash: promotion.sourceHash,
      }, { onConflict: "jorf_id" });
      if (error) throw error;
      await supabase.from("legislative_dossiers").update({ status_code: "promulgated", status_label: "Promulguée", current_chamber: "JORF", updated_at: new Date().toISOString() }).eq("id", match.dossier.id);
      promotedCount++;
    }
    await supabase.from("legislative_sync_runs").update({ status: "success", finished_at: new Date().toISOString(), processed_count: records.length, details: { archiveUrl, promotedCount } }).eq("id", run.id);
    console.log(`JORF: ${records.length} laws inspected, ${promotedCount} dossiers promoted.`);
    return { records: records.length, promoted: promotedCount };
  } catch (error: any) {
    await supabase.from("legislative_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_count: 1, details: { error: error.message } }).eq("id", run.id);
    throw error;
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncJorf().catch(error => { console.error(error); process.exitCode = 1; });
}
