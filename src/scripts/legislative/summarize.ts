import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { stableHash } from "../../lib/legislative/normalization.js";
import { trackLegislativeSync } from "../../lib/legislative/sync-run.js";
import { fetchExposeText } from "../../lib/legislative/expose.js";

// v2 : ajoute l'exposé des motifs (substance du texte) aux faits fournis au modèle.
const PROMPT_VERSION = "legislative-v2";

export async function summarizeLegislativeDossiers() {
  return trackLegislativeSync("legislative_summaries", async () => {
  const fields = "id,title,text_type,author_name,category,status_label,current_chamber,source_urls,source_hash";
  const { data: promulgatedLinks, error: promulgatedError } = await supabase.from("promulgated_laws").select("dossier_id");
  if (promulgatedError) throw promulgatedError;
  const promulgatedIds = (promulgatedLinks ?? []).map(row => row.dossier_id);
  const requestedLimit = Math.max(1, Number(process.env.LEGISLATIVE_SUMMARY_LIMIT ?? 50));
  const activeIds: string[] = [];
  let cursorDate: string | null = null;
  let cursorId: string | null = null;
  while (activeIds.length < requestedLimit) {
    const pageSize = Math.min(100, requestedLimit - activeIds.length);
    const { data: page, error: pageError } = await supabase.rpc("public_legislative_dossiers", { p_limit: pageSize, p_cursor_date: cursorDate, p_cursor_id: cursorId });
    if (pageError) throw pageError;
    if (!page?.length) break;
    activeIds.push(...page.map((row: any) => row.id));
    const last = page.at(-1) as any;
    cursorDate = last.source_updated_at;
    cursorId = last.id;
    if (page.length < pageSize) break;
  }
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
  let dossiers = [...new Map([...(promulgatedResult.data ?? []), ...(activeResult.data ?? [])].map(dossier => [dossier.id, dossier])).values()];

  // Mode CIBLÉ : force l'analyse de dossiers précis (par id), utile pour combler un dossier
  // manquant sans attendre son tour dans la file du backfill. Ex : SUMMARY_DOSSIER_IDS="uuid1,uuid2".
  if (process.env.SUMMARY_DOSSIER_IDS) {
    const ids = process.env.SUMMARY_DOSSIER_IDS.split(",").map(s => s.trim()).filter(Boolean);
    const { data, error } = await supabase.from("legislative_dossiers").select(fields).in("id", ids);
    if (error) throw error;
    dossiers = (data as any[]) ?? [];
    console.log(`[CIBLÉ] ${dossiers.length} dossier(s) demandé(s) à (ré)analyser.`);
  }
  // Mode BACKFILL : traite les dossiers SANS analyse publique (couvre le retard : anciens, Sénat…)
  // au lieu de la seule fenêtre « récents actifs + promulgués ».
  else if (process.env.SUMMARY_FILL_MISSING === "1") {
    const analyzed = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("legislative_analyses").select("dossier_id").eq("audience", "public").range(from, from + 999);
      if (!data || !data.length) break;
      for (const r of data) analyzed.add(r.dossier_id);
      if (data.length < 1000) break;
    }
    const missing: any[] = [];
    for (let from = 0; missing.length < requestedLimit; from += 1000) {
      const { data } = await supabase.from("legislative_dossiers").select(fields + ",source_updated_at").order("source_updated_at", { ascending: false }).range(from, from + 999);
      if (!data || !data.length) break;
      for (const d of (data as any[])) { if (!analyzed.has(d.id)) missing.push(d); if (missing.length >= requestedLimit) break; }
      if (data.length < 1000) break;
    }
    dossiers = missing;
    console.log(`[BACKFILL] ${analyzed.size} dossiers déjà analysés ; ${missing.length} manquants à traiter.`);
  }
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  let generated = 0;
  for (const dossier of dossiers) {
    // Fetch des faits officiels avec retries (évite les coupures Supabase sous charge en backfill).
    let stepsResult: any = {}, amendmentsResult: any = {}, scrutinsResult: any = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      [stepsResult, amendmentsResult, scrutinsResult] = await Promise.all([
        supabase.from("legislative_steps").select("step_label,chamber,occurred_at,source_url,source_hash").eq("dossier_id", dossier.id).order("sequence").limit(100),
        supabase.from("legislative_amendments").select("number,author_name,subject,outcome_label,voted_at,source_url,source_hash").eq("dossier_id", dossier.id).order("voted_at", { ascending: false }).limit(100),
        supabase.from("legislative_scrutins").select("title,result_label,for_count,against_count,abstain_count,voted_at,source_url,source_hash").eq("dossier_id", dossier.id).order("voted_at", { ascending: false }).limit(30),
      ]);
      if (!(stepsResult.error || amendmentsResult.error || scrutinsResult.error)) break;
      await sleep(800 * (attempt + 1));
    }
    if (stepsResult.error || amendmentsResult.error || scrutinsResult.error) {
      console.error(`Analysis unavailable for ${dossier.id}: official facts could not be loaded.`);
      continue;
    }
    // Exposé des motifs (PDF officiel) : ce que contient le texte et à quel problème il répond.
    // Plafonné à 18 000 caractères : au-delà, coût token élevé sans gain de qualité (et compatible
    // avec la fenêtre de sortie des modèles gratuits type Gemini Flash).
    const exposeDesMotifs = (await fetchExposeText(dossier.source_urls) || "").slice(0, 18000);
    // Cap les amendements/scrutins envoyés au LLM (les gros dossiers en ont 100+ → coût token énorme).
    const officialFacts = { dossier, expose_des_motifs: exposeDesMotifs, steps: (stepsResult.data || []).slice(0, 40), amendments: (amendmentsResult.data || []).slice(0, 30), scrutins: (scrutinsResult.data || []).slice(0, 20) };
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
        model: "deepseek-chat", max_tokens: 6000,
        responseFormat: "json_object",
        system: `Tu rédiges une analyse éditoriale à partir des faits officiels fournis (métadonnées, étapes, amendements, scrutins et surtout "expose_des_motifs" = le texte officiel expliquant le contenu et l'objectif de la proposition/projet de loi).

PRIORITÉ AU FOND : le résumé doit d'abord dire CE QUE PRÉVOIT le texte et À QUEL PROBLÈME il répond (mesures concrètes, dispositif, objectif), en t'appuyant sur "expose_des_motifs" quand il est présent. La procédure (dépôt, renvoi en commission, dates) est SECONDAIRE : une phrase suffit, jamais le cœur du résumé.

RÈGLES : n'invente aucun auteur, statut, date, vote, montant ni mesure ; ne cite que ce qui figure dans les faits fournis. Si "expose_des_motifs" est null ou vide, dis clairement que le contenu détaillé n'est pas encore disponible, puis résume au mieux à partir du titre et des métadonnées — sans meubler avec du jargon procédural.

Réponds en JSON strict avec DEUX clés dont les valeurs sont des CHAÎNES de texte :
- public_summary : 2-3 phrases grand public, centrées sur le fond ;
- premium_summary : une seule chaîne de texte (pas un objet), en 4 sections séparées par des sauts de ligne, chaque titre en gras markdown : "**Objet et mesures**", "**Problème visé**", "**Où en est le texte**", "**Limites**".`,
        messages: [{ role: "user", content: JSON.stringify(officialFacts) }],
      });
      const text = response.content[0]?.type === "text" ? response.content[0].text : "";
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON object in model response");
      const parsed = JSON.parse(match[0]);
      if (!parsed.public_summary || !parsed.premium_summary) throw new Error("Incomplete editorial response");
      // Sécurité : le front attend des chaînes ; si le modèle renvoie un objet structuré, on l'aplatit.
      const toStr = (v: any): string =>
        typeof v === "string" ? v
          : v && typeof v === "object" ? Object.entries(v).map(([k, val]) => `**${k}**\n${typeof val === "string" ? val : JSON.stringify(val)}`).join("\n\n")
          : String(v ?? "");
      const rows = [
        { dossier_id: dossier.id, audience: "public", summary: toStr(parsed.public_summary), source_urls: sourceUrls, input_hash: inputHash, prompt_version: PROMPT_VERSION },
        { dossier_id: dossier.id, audience: "premium", summary: toStr(parsed.premium_summary), source_urls: sourceUrls, input_hash: inputHash, prompt_version: PROMPT_VERSION },
      ];
      const { error: insertError } = await supabase.from("legislative_analyses").upsert(rows, { onConflict: "dossier_id,audience,input_hash,prompt_version" });
      if (insertError) throw insertError;
      generated++;
    } catch (cause) {
      console.error(`Analysis unavailable for ${dossier.id}:`, cause);
    }
    await sleep(120); // pace : ménage Supabase/DeepSeek en backfill
  }
  console.log(`Generated ${generated} sourced legislative analyses; failures were left unavailable.`);
  return generated;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) summarizeLegislativeDossiers().catch(error => { console.error(error); process.exitCode = 1; });
