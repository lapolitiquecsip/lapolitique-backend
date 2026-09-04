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

const MINISTRY_PROMPT = (entityName: string) => `Tu alimentes un fil qui documente L'ACTION d'une institution publique FRANÇAISE : « ${entityName} ». On veut savoir ce que l'institution FAIT — ce qu'elle annonce, décide, met en œuvre — pas ce qu'on dit d'elle.

À PUBLIER (should_publish=true) uniquement si l'article décrit une ACTION de cette institution : annonce, mesure, décision, plan/réforme, décret ou arrêté, financement/budget, nomination, lancement/déploiement, ouverture/inauguration, résultat ou bilan chiffré, texte déposé.

NE PAS PUBLIER (should_publish=false) :
- le COMMENTAIRE, l'opinion, la polémique, la réaction ou la critique de tiers (ex. « X critique… », « la gauche dénonce… ») ;
- le people / l'agenda personnel (vacances, déplacements privés, anecdotes) ;
- un article qui ne décrit PAS une action concrète de l'institution ;
- une institution ÉTRANGÈRE homonyme (gouvernement d'un autre pays, etc.).

- "title" : reformulé, factuel, centré sur l'action (max 14 mots).
- "summary" : 1-2 phrases (40 mots max), avec le fait/chiffre concret de l'action. En français.
- "news_type" : un parmi annonce | decision | mesure | budget | decret | nomination | lancement | bilan.

Réponds en JSON strict : { "should_publish": true, "title": "...", "summary": "...", "news_type": "annonce" }`;

const COMMUNE_PROMPT = (entityName: string) => `Tu alimentes le fil d'actualité LOCALE de la ville de « ${entityName} » (France) : ce qui se passe dans la commune et ce que fait la mairie.

À PUBLIER (should_publish=true) si l'article concerne la VIE LOCALE de CETTE commune : projet ou décision de la mairie, conseil municipal, travaux, urbanisme/construction, équipements (école, crèche, gymnase…), transports, budget municipal, événement local, sécurité/propreté, environnement, ouverture/inauguration.

NE PAS PUBLIER (should_publish=false) :
- une actualité nationale sans lien avec cette ville ;
- une AUTRE commune homonyme (vérifie que c'est bien cette ville-là) ;
- le fait divers pur (accident, faits divers people) sans dimension municipale ;
- le sport-résultats, la publicité.

- "title" : reformulé, factuel, centré sur le fait local (max 14 mots).
- "summary" : 1-2 phrases (40 mots max), le fait concret. En français.
- "news_type" : un parmi projet | travaux | conseil_municipal | budget | evenement | equipement | decision | actualite.

Réponds en JSON strict : { "should_publish": true, "title": "...", "summary": "...", "news_type": "projet" }`;

const REGION_PROMPT = (entityName: string) => `Tu alimentes le fil d'actualité RÉGIONALE de la région « ${entityName} » (France) : ce que fait le CONSEIL RÉGIONAL et ce qui concerne toute la région.

À PUBLIER (should_publish=true) si l'article concerne l'action de la RÉGION (compétences du conseil régional) : lycées, transports/TER, développement économique, formation professionnelle et apprentissage, aides et subventions régionales, budget régional, aménagement du territoire, environnement/énergie à l'échelle régionale, délibération de l'assemblée régionale, grand projet régional.

NE PAS PUBLIER (should_publish=false) :
- une actualité NATIONALE sans lien avec cette région ;
- une actu purement LOCALE d'une seule commune (sans dimension régionale) ;
- une AUTRE région / un homonyme (vérifie que c'est bien cette région-là) ;
- le fait divers, le sport-résultats, la publicité, le commentaire/polémique.

- "title" : reformulé, factuel, centré sur l'action régionale (max 14 mots).
- "summary" : 1-2 phrases (40 mots max), le fait/chiffre concret. En français.
- "news_type" : un parmi delibération | budget | aide | transport | lycee | developpement | formation | decision | actualite.

Réponds en JSON strict : { "should_publish": true, "title": "...", "summary": "...", "news_type": "delibération" }`;

const PARTY_PROMPT = (entityName: string) => `Tu alimentes le fil d'actualité du PARTI politique français « ${entityName} » : sa vie interne et son action politique.

À PUBLIER (should_publish=true) si l'article concerne CE parti : déclaration ou proposition officielle, position sur un sujet, congrès / élection interne / nomination d'un dirigeant, meeting ou université d'été, ligne stratégique, alliance ou rupture, résultat électoral, campagne, création/scission.

NE PAS PUBLIER (should_publish=false) :
- un article qui ne parle PAS de ce parti (simple mention en passant) ;
- un AUTRE parti homonyme ou étranger (vérifie que c'est bien celui-ci) ;
- le fait divers, le sport, la publicité, le commentaire d'un tiers sans fait nouveau.

- "title" : reformulé, factuel, centré sur le fait (max 14 mots).
- "summary" : 1-2 phrases (40 mots max), le fait concret. En français.
- "news_type" : un parmi annonce | proposition | congres | nomination | alliance | campagne | resultat | decision | actualite.

Réponds en JSON strict : { "should_publish": true, "title": "...", "summary": "...", "news_type": "annonce" }`;

async function summarise(entityName: string, title: string, snippet: string, entityType: string) {
  const promptFor = entityType === "commune" ? COMMUNE_PROMPT : entityType === "region" ? REGION_PROMPT : entityType === "party" ? PARTY_PROMPT : MINISTRY_PROMPT;
  const labelFor = entityType === "commune" ? "Ville" : entityType === "region" ? "Région" : entityType === "party" ? "Parti" : "Institution";
  const response = await resilientDeepSeek.createMessage({
    model: "deepseek-chat", max_tokens: 3000, responseFormat: "json_object",
    system: promptFor(entityName),
    messages: [{ role: "user", content: `${labelFor} : ${entityName}\nTitre : ${title}\nExtrait : ${snippet}` }],
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

export async function syncInstitutionNews() {
  let query = supabase.from("entity_feed_sources").select("*").eq("active", true);
  // Filtres optionnels (validation / garde-fou coût) : type d'entité + nombre max de sources.
  const onlyType = process.env.INSTITUTION_NEWS_ONLY_TYPE;
  if (onlyType) query = query.in("entity_type", onlyType.split(",").map(s => s.trim()).filter(Boolean));
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

    // Les PARTIS font l'actualité moins souvent que les communes/ministères : fenêtre de
    // fraîcheur élargie (60 j au lieu de 14) pour ne pas les laisser sans fil d'actu.
    const freshDays = src.entity_type === "party" ? 60 : FRESH_DAYS;
    let perSource = 0;
    for (const item of items) {
      if (perSource >= MAX_ITEMS_PER_SOURCE) break;
      const link = item.link || "";
      if (!link || known.has(link)) continue;

      // Fraîcheur
      const pub = item.isoDate ? new Date(item.isoDate) : null;
      if (pub && (Date.now() - pub.getTime()) / 86400000 > freshDays) continue;

      const { title: rawTitle } = cleanGoogleTitle(item.title || "");
      if (!rawTitle || rawTitle.length < 12) continue;

      // Filtre heuristique AVANT LLM (surtout pour Google News : désambiguïsation). Sauté pour les
      // PARTIS (noms souvent ambigus + articles centrés sur le dirigeant) : l'IA tranche la pertinence.
      if (src.kind === "google_news" && src.entity_type !== "party" && !mentionsEntity(rawTitle, src.entity_name)) continue;

      scanned++;
      const snippet = (item.contentSnippet || item.content || "").slice(0, 500);
      let ai;
      try { ai = await summarise(src.entity_name, rawTitle, snippet, src.entity_type); }
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
