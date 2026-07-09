import "dotenv/config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "tar";
import { supabase } from "../../config/supabase.js";
import { parseJorfXml } from "../../lib/legislative/jorf-adapter.js";
import { selectJorfArchiveUrls } from "../../lib/legislative/jorf-archives.js";
import { legislativeTitleMatchScore, promoteFromJorf, stableHash, type NormalizedDossier } from "../../lib/legislative/normalization.js";

const DIRECTORY_URL = "https://echanges.dila.gouv.fr/OPENDATA/JORFSIMPLE/";

async function archiveUrls(year?: number) {
  const response = await fetch(DIRECTORY_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`DILA archive index HTTP ${response.status}`);
  const urls = selectJorfArchiveUrls(await response.text(), DIRECTORY_URL, year ? {
    year,
    through: new Date().toISOString().slice(0, 10),
  } : {});
  if (!urls.length) throw new Error(`No JORFSIMPLE archive found${year ? ` for ${year}` : ""}`);
  return urls;
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

async function fetchArchiveBuffer(archiveUrl: string, attempts = 5): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`DILA archive HTTP ${response.status}: ${archiveUrl}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      // Le serveur DILA coupe/temporise régulièrement (UND_ERR_SOCKET, TimeoutError).
      // On réessaie avec un backoff progressif plutôt que d'abandonner tout le backfill.
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError;
}

async function recordsFromArchive(archiveUrl: string, root: string) {
  const archiveDirectory = await fs.mkdtemp(path.join(root, "archive-"));
  const archive = path.join(archiveDirectory, "jorf.tar.gz");
  try {
    await fs.writeFile(archive, await fetchArchiveBuffer(archiveUrl));
    await extract({ file: archive, cwd: archiveDirectory, filter: entryPath => /JORFTEXT.*\.xml$/.test(entryPath) });
    return (await Promise.all((await xmlFiles(archiveDirectory)).map(async file => parseJorfXml(await fs.readFile(file, "utf8")))))
      .filter((record): record is NonNullable<typeof record> => record !== null);
  } finally {
    await fs.rm(archiveDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, mapper: (value: T, index: number) => Promise<R>) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  }));
  return results;
}

export async function syncJorf(options: { year?: number } = {}) {
  const { data: run, error: runError } = await supabase.from("legislative_sync_runs").insert({ pipeline: "jorf", status: "running" }).select("id").single();
  if (runError) throw runError;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "lapolitique-jorf-"));
  try {
    const urls = await archiveUrls(options.year);
    const archiveRecords = await mapConcurrent(urls, 6, async (archiveUrl, index) => {
      const records = await recordsFromArchive(archiveUrl, temp);
      if (options.year && ((index + 1) % 25 === 0 || index + 1 === urls.length)) {
        console.log(`JORF backfill: ${index + 1}/${urls.length} archives inspected.`);
      }
      return records;
    });
    const records = [...new Map(archiveRecords.flat().map(record => [record.jorfId, record])).values()]
      .filter(record => !options.year || record.publishedAt.startsWith(String(options.year)));

    const rows: any[] = [];
    const pageSize = 1_000;
    for (let offset = 0; ; offset += pageSize) {
      const { data: page, error: dossierError } = await supabase
        .from("legislative_dossiers")
        .select("*")
        .eq("legislature", 17)
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (dossierError) throw dossierError;
      rows.push(...(page ?? []));
      if ((page?.length ?? 0) < pageSize) break;
    }
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
      const match = dossiers
        .map(dossier => ({ dossier, score: legislativeTitleMatchScore(dossier.title, record.title), promotion: promoteFromJorf(dossier, record) }))
        .filter(value => value.promotion)
        .sort((a, b) => b.score - a.score
          || Number(b.dossier.officialId.startsWith("DLR5L17")) - Number(a.dossier.officialId.startsWith("DLR5L17")))[0];
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
      // Un dossier ne peut être promulgué qu'une fois. Si une autre publication JORF est
      // déjà liée à ce dossier, on ignore ce doublon (contrainte dossier_id) au lieu
      // d'interrompre tout le backfill : les imports restent idempotents.
      if (error) {
        if (error.code === "23505") continue;
        throw error;
      }
      await supabase.from("legislative_dossiers").update({ status_code: "promulgated", status_label: "Promulguée", current_chamber: "JORF", updated_at: new Date().toISOString() }).eq("id", match.dossier.id);
      promotedCount++;
    }
    const [{ data: promotedDossiers, error: promotedError }, { data: linkedLaws, error: linkedError }] = await Promise.all([
      supabase.from("legislative_dossiers").select("id").eq("status_code", "promulgated"),
      supabase.from("promulgated_laws").select("dossier_id"),
    ]);
    if (promotedError) throw promotedError;
    if (linkedError) throw linkedError;
    const linkedIds = new Set((linkedLaws ?? []).map(row => row.dossier_id));
    const orphanIds = (promotedDossiers ?? []).map(row => row.id).filter(id => !linkedIds.has(id));
    for (let offset = 0; offset < orphanIds.length; offset += 50) {
      const { error } = await supabase.from("legislative_dossiers").update({
        status_code: "awaiting_jorf_verification",
        status_label: "Publication JORF à vérifier",
        updated_at: new Date().toISOString(),
      }).in("id", orphanIds.slice(offset, offset + 50));
      if (error) throw error;
    }
    await supabase.from("legislative_sync_runs").update({ status: "success", finished_at: new Date().toISOString(), processed_count: records.length, details: { archiveCount: urls.length, year: options.year ?? null, promotedCount } }).eq("id", run.id);
    console.log(`JORF: ${records.length} laws inspected, ${promotedCount} dossiers promoted.`);
    return { records: records.length, promoted: promotedCount };
  } catch (error: any) {
    await supabase.from("legislative_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_count: 1, details: { error: error.message } }).eq("id", run.id);
    throw error;
  } finally {
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const yearArgument = process.argv.find(argument => argument.startsWith("--year="));
  const year = yearArgument ? Number(yearArgument.slice("--year=".length)) : undefined;
  if (yearArgument && (!Number.isInteger(year) || year! < 1990 || year! > new Date().getUTCFullYear())) {
    throw new Error(`Invalid JORF backfill year: ${yearArgument}`);
  }
  syncJorf({ year }).catch(error => { console.error(error); process.exitCode = 1; });
}
