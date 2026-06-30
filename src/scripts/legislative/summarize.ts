import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { stableHash } from "../../lib/legislative/normalization.js";
import { trackLegislativeSync } from "../../lib/legislative/sync-run.js";

const PROMPT_VERSION = "legislative-v1";

export async function summarizeLegislativeDossiers() {
  return trackLegislativeSync("legislative_summaries", async () => {
  const fields = "id,title,text_type,author_name,category,status_label,current_chamber,source_urls,source_hash";
  const { data: promulgatedLinks, error: promulgatedError } = await supabase.from("promulgated_laws").select("dossier_id");
  if (promulgatedError) throw promulgatedError;
  const promulgatedIds = (promulgatedLinks ?? []).map(row => row.dossier_id);
  const { data: publicActive, error: publicActiveError } = await supabase.rpc("public_legislative_dossiers", { p_limit: 50 });
  if (publicActiveError) throw publicActiveError;
  const activeIds = (publicActive ?? []).map((row: any) => row.id);
  const [promulgatedResult, activeResult] = await Promise.all([
    promulgatedIds.length
      ? supabase.from("legislative_dossiers").select(fields).in("id", promulgatedIds)
      : Promise.resolve({ data: [], error: null }),
    activeIds.length
      ? supabase.from("legislative_dossiers").select(fields).in("id", activeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (promulgatedResult.error) throw promulgatedResult.error;
  if (activeResult.error) throw activeResult.error;
  const dossiers = [...new Map([...(promulgatedResult.data ?? []), ...(activeResult.data ?? [])].map(dossier => [dossier.id, dossier])).values()];
  let generated = 0;
  for (const dossier of dossiers) {
    const [stepsResult, amendmentsResult, scrutinsResult] = await Promise.all([
      supabase.from("legislative_steps").select("step_label,chamber,occurred_at,source_url,source_hash").eq("dossier_id", dossier.id).order("sequence").limit(100),
      supabase.from("legislative_amendments").select("number,author_name,subject,outcome_label,voted_at,source_url,source_hash").eq("dossier_id", dossier.id).order("voted_at", { ascending: false }).limit(100),
      supabase.from("legislative_scrutins").select("title,result_label,for_count,against_count,abstain_count,voted_at,source_url,source_hash").eq("dossier_id", dossier.id).order("voted_at", { ascending: false }).limit(30),
    ]);
    if (stepsResult.error || amendmentsResult.error || scrutinsResult.error) {
      console.error(`Analysis unavailable for ${dossier.id}: official facts could not be loaded.`);
      continue;
    }
    const officialFacts = { dossier, steps: stepsResult.data, amendments: amendmentsResult.data, scrutins: scrutinsResult.data };
    const sourceUrls = [...new Set([
      ...(dossier.source_urls ?? []),
      ...(stepsResult.data ?? []).map(item => item.source_url),
      ...(amendmentsResult.data ?? []).map(item => item.source_url),
      ...(scrutinsResult.data ?? []).map(item => item.source_url),
    ].filter(Boolean))];
    const inputHash = stableHash({ officialFacts, prompt: PROMPT_VERSION });
    const { count } = await supabase.from("legislative_analyses").select("id", { count: "exact", head: true }).eq("dossier_id", dossier.id).eq("input_hash", inputHash).eq("prompt_version", PROMPT_VERSION);
    if ((count ?? 0) >= 2) continue;
    try {
      const response = await resilientDeepSeek.createMessage({
        model: "deepseek-v4-flash", max_tokens: 1800,
        responseFormat: "json_object",
        system: `Tu rédiges uniquement une analyse éditoriale à partir des faits officiels fournis. N'invente aucun auteur, statut, date, vote, montant ou mesure. Si les faits sont insuffisants, indique clairement les limites. Réponds en JSON strict avec public_summary (2-3 phrases) et premium_summary (analyse structurée détaillée).`,
        messages: [{ role: "user", content: JSON.stringify(officialFacts) }],
      });
      const text = response.content[0]?.type === "text" ? response.content[0].text : "";
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON object in model response");
      const parsed = JSON.parse(match[0]);
      if (!parsed.public_summary || !parsed.premium_summary) throw new Error("Incomplete editorial response");
      const rows = [
        { dossier_id: dossier.id, audience: "public", summary: parsed.public_summary, source_urls: sourceUrls, input_hash: inputHash, prompt_version: PROMPT_VERSION },
        { dossier_id: dossier.id, audience: "premium", summary: parsed.premium_summary, source_urls: sourceUrls, input_hash: inputHash, prompt_version: PROMPT_VERSION },
      ];
      const { error: insertError } = await supabase.from("legislative_analyses").upsert(rows, { onConflict: "dossier_id,audience,input_hash,prompt_version" });
      if (insertError) throw insertError;
      generated++;
    } catch (cause) {
      console.error(`Analysis unavailable for ${dossier.id}:`, cause);
    }
  }
  console.log(`Generated ${generated} sourced legislative analyses; failures were left unavailable.`);
  return generated;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) summarizeLegislativeDossiers().catch(error => { console.error(error); process.exitCode = 1; });
