import { createHash } from "node:crypto";
import { supabase } from "../config/supabase.js";

export type IngestionMode = "incremental" | "backfill" | "dry-run" | "reconcile";

export interface SourceDefinition {
  slug: string;
  domain: string;
  producer: string;
  datasetName: string;
  datasetUrl: string;
  licence: string;
  expectedFrequency: string;
  expectedColumns?: string[];
}

export const OFFICIAL_SOURCES: SourceDefinition[] = [
  { slug: "insee-local", domain: "territories", producer: "Insee", datasetName: "Données locales et recensement", datasetUrl: "https://www.insee.fr/fr/information/3544265", licence: "Licence Ouverte 2.0", expectedFrequency: "1 month" },
  { slug: "drees-apl", domain: "territories", producer: "DREES/IRDES", datasetName: "Accessibilité potentielle localisée", datasetUrl: "https://www.data.gouv.fr/datasets/donnees-sur-lindicateur-daccessibilite-potentielle-localisee-apl", licence: "Licence Ouverte 2.0", expectedFrequency: "1 month" },
  { slug: "ssmsi-delinquance", domain: "territories", producer: "SSMSI", datasetName: "Délinquance enregistrée", datasetUrl: "https://www.data.gouv.fr/datasets/bases-statistiques-communale-departementale-et-regionale-de-la-delinquance-enregistree-par-la-police-et-la-gendarmerie-nationales", licence: "Licence Ouverte 2.0", expectedFrequency: "1 month" },
  { slug: "dgfip-dvf", domain: "territories", producer: "DGFiP", datasetName: "Demandes de valeurs foncières", datasetUrl: "https://cadastre.data.gouv.fr/dvf", licence: "Licence Ouverte 2.0", expectedFrequency: "7 days" },
  { slug: "sdes-rpls", domain: "territories", producer: "SDES", datasetName: "Répertoire du parc locatif social", datasetUrl: "https://www.data.gouv.fr/datasets/donnees-detaillees-au-logement-du-repertoire-des-logements-locatifs-des-bailleurs-sociaux-rpls", licence: "Licence Ouverte 2.0", expectedFrequency: "1 month" },
  { slug: "ofgl-accounts", domain: "territories", producer: "OFGL/DGFiP", datasetName: "Comptes des collectivités", datasetUrl: "https://data.ofgl.fr", licence: "Licence Ouverte 2.0", expectedFrequency: "7 days" },
  { slug: "georisques", domain: "territories", producer: "Ministère de la Transition écologique", datasetName: "API Géorisques", datasetUrl: "https://georisques.gouv.fr/api/v1/", licence: "Licence Ouverte 2.0", expectedFrequency: "7 days" },
  { slug: "rne", domain: "officials", producer: "Ministère de l'Intérieur", datasetName: "Répertoire national des élus", datasetUrl: "https://www.data.gouv.fr/datasets/repertoire-national-des-elus-1", licence: "Licence Ouverte 2.0", expectedFrequency: "7 days" },
  { slug: "interieur-elections", domain: "elections", producer: "Ministère de l'Intérieur", datasetName: "Données des élections agrégées", datasetUrl: "https://www.data.gouv.fr/datasets/donnees-des-elections-agregees", licence: "Licence Ouverte 2.0", expectedFrequency: "1 day" },
  { slug: "budget-etat", domain: "state-budget", producer: "Direction du Budget", datasetName: "Budget de l'État", datasetUrl: "https://www.budget.gouv.fr/open-data", licence: "Licence Ouverte 2.0", expectedFrequency: "7 days" },
];

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function requireServiceRole() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for ingestion");
}

export async function registerSource(source: SourceDefinition) {
  requireServiceRole();
  const { data, error } = await supabase.from("data_sources").upsert({
    slug: source.slug,
    domain: source.domain,
    producer: source.producer,
    dataset_name: source.datasetName,
    dataset_url: source.datasetUrl,
    licence: source.licence,
    expected_frequency: source.expectedFrequency,
    expected_schema: { columns: source.expectedColumns ?? [] },
    active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "slug" }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function runIngestion<T>(options: { domain: string; jobName: string; source?: SourceDefinition; mode?: IngestionMode }, task: (context: { runId: string; sourceId?: string; dryRun: boolean }) => Promise<{ result: T; rowsRead?: number; rowsWritten?: number; rowsRejected?: number; details?: object }>) {
  requireServiceRole();
  const mode = options.mode ?? (process.env.INGESTION_MODE as IngestionMode | undefined) ?? "incremental";
  const sourceId = options.source ? await registerSource(options.source) : undefined;
  const { data: run, error } = await supabase.from("ingestion_runs").insert({ domain: options.domain, job_name: options.jobName, mode, source_id: sourceId }).select("id").single();
  if (error) throw error;
  try {
    const outcome = await task({ runId: run.id, sourceId, dryRun: mode === "dry-run" });
    const { error: finishError } = await supabase.from("ingestion_runs").update({ status: "succeeded", finished_at: new Date().toISOString(), rows_read: outcome.rowsRead ?? 0, rows_written: outcome.rowsWritten ?? 0, rows_rejected: outcome.rowsRejected ?? 0, details: outcome.details ?? {} }).eq("id", run.id);
    if (finishError) throw finishError;
    return outcome.result;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await supabase.from("ingestion_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_message: message }).eq("id", run.id);
    throw cause;
  }
}

export async function upsertInChunks(table: string, rows: Record<string, unknown>[], onConflict: string, chunkSize = 500) {
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table} upsert failed at row ${offset}: ${error.message}`);
    written += chunk.length;
  }
  return written;
}
