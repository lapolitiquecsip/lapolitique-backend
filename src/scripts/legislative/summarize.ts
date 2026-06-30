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
  const { data: dossiers, error } = await supabase.from("legislative_dossiers")
    .select("id,title,text_type,author_name,category,status_label,current_chamber,source_urls,source_hash")
    .order("latest_step_at", { ascending: false, nullsFirst: false }).limit(50);
  if (error) throw error;
  let generated = 0;
  for (const dossier of dossiers ?? []) {
    const inputHash = stableHash({ sourceHash: dossier.source_hash, prompt: PROMPT_VERSION });
    const { count } = await supabase.from("legislative_analyses").select("id", { count: "exact", head: true }).eq("dossier_id", dossier.id).eq("input_hash", inputHash).eq("prompt_version", PROMPT_VERSION);
    if ((count ?? 0) >= 2) continue;
    try {
      const response = await resilientDeepSeek.createMessage({
        model: "deepseek-v4-flash", max_tokens: 1800,
        system: `Tu rédiges uniquement une analyse éditoriale à partir des faits officiels fournis. N'invente aucun auteur, statut, date, vote, montant ou mesure. Si les faits sont insuffisants, indique clairement les limites. Réponds en JSON strict avec public_summary (2-3 phrases) et premium_summary (analyse structurée détaillée).`,
        messages: [{ role: "user", content: JSON.stringify(dossier) }],
      });
      const text = response.content[0]?.type === "text" ? response.content[0].text : "";
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON object in model response");
      const parsed = JSON.parse(match[0]);
      if (!parsed.public_summary || !parsed.premium_summary) throw new Error("Incomplete editorial response");
      const rows = [
        { dossier_id: dossier.id, audience: "public", summary: parsed.public_summary, source_urls: dossier.source_urls, input_hash: inputHash, prompt_version: PROMPT_VERSION },
        { dossier_id: dossier.id, audience: "premium", summary: parsed.premium_summary, source_urls: dossier.source_urls, input_hash: inputHash, prompt_version: PROMPT_VERSION },
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
