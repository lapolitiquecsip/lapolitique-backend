import "dotenv/config";
import Parser from "rss-parser";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Brique #4 — Fil d'actualité par institution (ministères, départements).
// Flux gratuits (RSS officiels + Google News) → filtre heuristique (AVANT LLM, pour économiser
// les tokens) → résumé DeepSeek court → table entity_feed. Droit d'auteur : on ne stocke que le
// titre reformulé, un résumé de ≤40 mots et le lien — jamais le texte intégral. Quotidien (cron).

const parser = new Parser({ timeout: 15000, headers: { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" } });
const MAX_ITEMS_PER_SOURCE = 5;   // borne le coût LLM par entité et par passe
const FRESH_DAYS = 14;            // on ignore les articles plus vieux que ça
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const deacc = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Un item Google News passe le filtre s'il évoque bien l'entité (désambiguïsation homonymes).
function mentionsEntity(title: string, entityName: string): boolean {
  const t = deacc(title);
  const toks = deacc(entityName).split(/\s+/).filter(w => w.length > 3); // mots significatifs
  if (!toks.length) return true;
  const hits = toks.filter(w => t.includes(w)).length;
  return hits >= Math.min(2, toks.length); // au moins 2 mots-clés (ou tous si nom court)
}

function cleanGoogleTitle(title: string): { title: string; source: string } {
  const idx = title.lastIndexOf(" - ");
  if (idx > 0) return { title: title.slice(0, idx).trim(), source: title.slice(idx + 3).trim() };
  return { title: title.trim(), source: "" };
}

async function summarise(entityName: string, title: string, snippet: string) {
  const response = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash", max_tokens: 3000, responseFormat: "json_object",
    system: `Tu alimentes le fil d'actualité d'une institution publique FRANÇAISE : « ${entityName} » (gouvernement/collectivité de la France). À partir du titre et de l'extrait d'un article, produis une entrée courte et factuelle.

RÈGLES :
- "should_publish" = false si l'article ne concerne PAS réellement CETTE institution française, ou n'a aucun intérêt (people, hors-sujet, publicité).
- "should_publish" = false si l'article concerne une institution ÉTRANGÈRE homonyme (ex. un « ministère de la Justice » d'un autre pays, le gouvernement américain, etc.).
- "title" : titre reformulé, factuel, sans sensationnalisme (max 14 mots).
- "summary" : 1-2 phrases (40 mots max), un fait/chiffre concret si présent. En français.
- "news_type" : un parmi annonce | decision | travaux | budget | evenement | nomination | actualite.

Réponds en JSON strict : { "should_publish": true, "title": "...", "summary": "...", "news_type": "actualite" }`,
    messages: [{ role: "user", content: `Institution : ${entityName}\nTitre : ${title}\nExtrait : ${snippet}` }],
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

export async function syncInstitutionNews() {
  let query = supabase.from("entity_feed_sources").select("*").eq("active", true);
  // Filtres optionnels (validation / garde-fou coût) : type d'entité + nombre max de sources.
  const onlyType = process.env.INSTITUTION_NEWS_ONLY_TYPE;
  if (onlyType) query = query.eq("entity_type", onlyType);
  const maxSources = Number(process.env.INSTITUTION_NEWS_MAX_SOURCES ?? 0);
  const { data: sourcesAll, error } = await query;
  if (error) throw error;
  const sources = maxSources > 0 ? (sourcesAll || []).slice(0, maxSources) : (sourcesAll || []);
  console.log(`[Institution-News] ${sources.length} source(s) traitée(s)${maxSources > 0 ? ` (plafond ${maxSources})` : ""}.`);

  let inserted = 0, scanned = 0;
  for (const src of sources || []) {
    let feed;
    try { feed = await parser.parseURL(src.feed_url); }
    catch { continue; }
    const items = (feed.items || []).slice(0, 20);

    // URLs déjà connues pour cette entité (déduplication).
    const urls = items.map(i => i.link).filter(Boolean) as string[];
    const known = new Set<string>();
    if (urls.length) {
      const { data: existing } = await supabase.from("entity_feed")
        .select("url").eq("entity_type", src.entity_type).eq("entity_id", src.entity_id).in("url", urls);
      for (const r of existing || []) known.add(r.url);
    }

    let perSource = 0;
    for (const item of items) {
      if (perSource >= MAX_ITEMS_PER_SOURCE) break;
      const link = item.link || "";
      if (!link || known.has(link)) continue;

      // Fraîcheur
      const pub = item.isoDate ? new Date(item.isoDate) : null;
      if (pub && (Date.now() - pub.getTime()) / 86400000 > FRESH_DAYS) continue;

      const { title: rawTitle } = cleanGoogleTitle(item.title || "");
      if (!rawTitle || rawTitle.length < 12) continue;

      // Filtre heuristique AVANT LLM (surtout pour Google News : désambiguïsation).
      if (src.kind === "google_news" && !mentionsEntity(rawTitle, src.entity_name)) continue;

      scanned++;
      const snippet = (item.contentSnippet || item.content || "").slice(0, 500);
      let ai;
      try { ai = await summarise(src.entity_name, rawTitle, snippet); }
      catch { await sleep(500); continue; }
      if (!ai || ai.should_publish === false || !ai.title || !ai.summary) continue;

      const row = {
        entity_type: src.entity_type, entity_id: src.entity_id,
        source_name: src.source_name, source_kind: src.kind,
        url: link, title: ai.title, summary: ai.summary,
        news_type: ai.news_type || "actualite", topic: null,
        published_at: pub ? pub.toISOString() : null,
      };
      const { error: upErr } = await supabase.from("entity_feed").upsert(row, { onConflict: "entity_type,entity_id,url" });
      if (upErr) { console.warn("upsert:", upErr.message); continue; }
      inserted++; perSource++;
    }
  }
  console.log(`[Institution-News] Terminé. ${scanned} items analysés (LLM), ${inserted} publiés.`);
  return inserted;
}

if (process.argv[1]) syncInstitutionNews().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
