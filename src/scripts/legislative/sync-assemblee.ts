import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../../config/supabase.js";
import { parseAssembleeDossier } from "../../lib/legislative/assemblee-adapter.js";
import { downloadAndUnzip } from "../automation/utils.js";

// Legislature parametrable (voir fetch-votes.ts) : 17 par defaut, 16 pour le backfill 2022-2024.
const LEGISLATURE = process.env.AN_LEGISLATURE || "17";
const ZIP_URL = `https://data.assemblee-nationale.fr/static/openData/repository/${LEGISLATURE}/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDirectory = path.join(root, "data", "laws_an");

function chunks<T>(values: T[], size = 250): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

export async function syncAssemblee() {
  const { data: run, error: runError } = await supabase.from("legislative_sync_runs").insert({ pipeline: "assemblee", status: "running" }).select("id").single();
  if (runError) throw runError;

  try {
    await downloadAndUnzip(ZIP_URL, dataDirectory);
    const { data: deputies, error: deputyError } = await supabase.from("deputies").select("an_id,first_name,last_name");
    if (deputyError) throw deputyError;
    const actors = new Map((deputies ?? []).map(row => [row.an_id, `${row.first_name} ${row.last_name}`.trim()]));
    const directory = path.join(dataDirectory, "json", "dossierParlementaire");
    const parsed = fs.readdirSync(directory)
      .filter(file => file.endsWith(".json"))
      .map(file => parseAssembleeDossier(JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")), actors))
      .filter((value): value is NonNullable<typeof value> => value !== null);

    for (const batch of chunks(parsed)) {
      const rows = batch.map(({ dossier }) => ({
        official_id: dossier.officialId,
        legislature: dossier.legislature,
        title: dossier.title,
        text_type: dossier.textType,
        author_kind: dossier.authorKind,
        author_name: dossier.authorName,
        category: dossier.category,
        status_code: dossier.statusCode,
        status_label: dossier.statusLabel,
        current_chamber: dossier.currentChamber,
        deposited_at: dossier.depositedAt,
        // Dernière étape RÉELLEMENT survenue (≤ maintenant) — on ignore les réunions
        // futures programmées qui feraient remonter à tort le dossier dans la navette.
        latest_step_at: (() => {
          const nowIso = new Date().toISOString();
          const dates = (batch.find(item => item.dossier.officialId === dossier.officialId)?.steps ?? [])
            .map(s => s.occurredAt).filter((d): d is string => !!d && d <= nowIso).sort();
          return dates.at(-1) ?? null;
        })(),
        source_urls: dossier.sourceUrls,
        source_updated_at: dossier.sourceUpdatedAt,
        source_hash: dossier.sourceHash,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("legislative_dossiers").upsert(rows, { onConflict: "official_id" });
      if (error) throw error;
    }
    for (const batch of chunks(parsed)) {
      const { error } = await supabase.from("legislative_source_records").upsert(batch.map(({ dossier }) => ({
        provider: "AN", record_type: "dossier", official_id: dossier.officialId,
        source_url: dossier.sourceUrls[0], source_updated_at: dossier.sourceUpdatedAt,
        source_hash: dossier.sourceHash, raw_excerpt: { title: dossier.title, status: dossier.statusLabel },
      })), { onConflict: "provider,record_type,official_id,source_hash" });
      if (error) throw error;
    }

    const ids = parsed.map(item => item.dossier.officialId);
    const idRows: Array<{ id: string; official_id: string }> = [];
    for (const batch of chunks(ids)) {
      const { data, error } = await supabase.from("legislative_dossiers").select("id,official_id").in("official_id", batch);
      if (error) throw error;
      idRows.push(...(data ?? []));
    }
    const dossierIds = new Map(idRows.map(row => [row.official_id, row.id]));
    const stepRows = parsed.flatMap(item => item.steps.map(step => ({
      official_id: step.officialId,
      dossier_id: dossierIds.get(item.dossier.officialId),
      chamber: step.chamber,
      step_code: step.code,
      step_label: step.label,
      occurred_at: step.occurredAt,
      sequence: step.sequence,
      source_url: step.sourceUrl,
      source_updated_at: item.dossier.sourceUpdatedAt,
      source_hash: step.sourceHash,
    }))).filter(row => row.dossier_id);
    for (const batch of chunks(stepRows)) {
      const { error } = await supabase.from("legislative_steps").upsert(batch, { onConflict: "official_id" });
      if (error) throw error;
    }

    const finishedAt = new Date().toISOString();
    await supabase.from("legislative_sync_runs").update({ status: "success", finished_at: finishedAt, processed_count: parsed.length }).eq("id", run.id);
    console.log(`Assemblée nationale: ${parsed.length} dossiers and ${stepRows.length} steps synchronized.`);
    return { dossiers: parsed.length, steps: stepRows.length };
  } catch (error: any) {
    await supabase.from("legislative_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_count: 1, details: { error: error.message } }).eq("id", run.id);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncAssemblee().catch(error => { console.error(error); process.exitCode = 1; });
}
