import "dotenv/config";
import Parser from "rss-parser";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { quasiDoublon } from "../../lib/quasi-doublon.js";

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

// ── Fil des PARTIS : il ne doit jamais tomber en panne ─────────────────────────────
// Trois secours successifs : (1) Bing Actualités si Google News ne répond pas ;
// (2) DeepSeek payant si le quota IA gratuit du jour est épuisé ; (3) sans aucune IA,
// le titre de presse tel quel, s'il nomme bien le parti et n'est pas un simple avis.

/** Termes entre guillemets de la requête Google News (« Rassemblement National », « Jordan Bardella »). */
function termesRequete(feedUrl: string): string[] {
  try {
    const q = new URL(feedUrl).searchParams.get("q") || "";
    return [...q.matchAll(/"([^"]{2,60})"/g)].map(m => m[1]);
  } catch { return []; }
}

/** Même recherche sur Bing Actualités (RSS public, sans clé). */
function urlBing(feedUrl: string): string | null {
  const termes = termesRequete(feedUrl);
  if (!termes.length) return null;
  return `https://www.bing.com/news/search?q=${encodeURIComponent(termes.map(t => `"${t}"`).join(" OR "))}&format=rss&setlang=fr-FR&cc=FR`;
}

async function lireFlux(src: any) {
  try {
    const f = await parser.parseURL(src.feed_url);
    if ((f.items || []).length) return f;
  } catch { /* on tente le secours */ }
  const bing = src.entity_type === "party" && src.kind === "google_news" ? urlBing(src.feed_url) : null;
  if (!bing) return null;
  try { const f = await parser.parseURL(bing); console.log(`  ↪ ${src.entity_name} : Google News muet, relevé via Bing.`); return f; }
  catch { return null; }
}

/** Avis, réaction ou commentaire d'un tiers : pas un fait de la vie du parti. */
const AVIS = /\b(selon|pour (?:[A-ZÉ][\wéèàç-]+ ){1,3}[,:]|estime|juge|jugent|dénonce|dénoncent|fustige|tacle|réagit|réagissent|critique|accuse|charge contre|s'en prend|tribune|édito|chronique|opinion|analyse|décryptage|sondage|qu'en pensez|faut-il)\b|\?\s*$|^«|^"/i;

/** Publication sans IA : le titre doit nommer le parti (ou un terme de sa requête) et ne pas être un avis. */
function brutPubliable(titre: string, src: any): boolean {
  if (AVIS.test(titre)) return false;
  if (/(…|\.\.\.)\s*$/.test(titre)) return false;   // titre coupé : jamais publié tel quel
  const t = deacc(titre);
  return termesRequete(src.feed_url).some(x => x.length >= 3 && t.includes(deacc(x))) || mentionsEntity(titre, src.entity_name);
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

// Complément des fils de DÉPARTEMENT et de RÉGION. Ces fils ramassent aussi des
// articles sur UNE commune (« Dans cette commune de Loire-Atlantique, les élus
// actent la démolition de l'église ») ; réécrit sans lieu, le titre devenait « La
// municipalité acte la démolition de l'église communale », et l'alerte partait à
// tout le département sans que personne puisse savoir de quelle ville il s'agissait.
const LIEU_PROMPT = (entityName: string) => `

LIEU — obligatoire :
- "portee" : "territoire" pour toute DÉCISION de la préfecture, du conseil départemental ou régional (arrêté, restriction d'eau ou sécheresse sur un secteur, fermeture d'une route départementale, budget, subvention), pour une mesure générale ou qui touche plusieurs communes — MÊME si un lieu est cité ; "commune" seulement pour un fait de la vie d'UNE commune (conseil municipal, chantier municipal, église, école, commerce fermé, événement local).
- "lieu" : le nom de la commune citée dans le titre ou l'extrait, quelle que soit la portée ; null s'il n'y est pas nommé. N'invente jamais un nom de commune.
- Le "title" NOMME la commune quand elle est connue (« Saint-Nazaire : … »). Si l'article parle d'une commune sans la nommer, écris « Une commune de ${entityName} … » — jamais « la municipalité », « la commune » ou « la mairie » seules, qui laissent croire au lecteur qu'il s'agit de la sienne.
Ajoute ces deux champs au JSON : "portee" et "lieu".`;

async function summarise(entityName: string, title: string, snippet: string, entityType: string, payant = false) {
  const promptFor = entityType === "commune" ? COMMUNE_PROMPT : entityType === "region" ? REGION_PROMPT : entityType === "party" ? PARTY_PROMPT : MINISTRY_PROMPT;
  const labelFor = entityType === "commune" ? "Ville" : entityType === "region" ? "Région" : entityType === "party" ? "Parti" : "Institution";
  const territorial = entityType === "department" || entityType === "region";
  const response = await resilientDeepSeek.createMessage({
    model: "deepseek-chat", max_tokens: 3000, responseFormat: "json_object",
    system: promptFor(entityName) + (territorial ? LIEU_PROMPT(entityName) : ""),
    messages: [{ role: "user", content: `${labelFor} : ${entityName}\nTitre : ${title}\nExtrait : ${snippet}` }],
    sansReflexion: true,
  }, { payant });
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

  // Échecs de l'IA comptés, et non plus avalés : pendant deux semaines de septembre,
  // le quota gratuit du jour était épuisé à l'heure du passage, chaque résumé échouait
  // en silence et le fil des communes ne recevait plus rien, passage « réussi ».
  let inserted = 0, scanned = 0, echecs = 0, quotaVide = 0, arret = false;
  // Quota gratuit épuisé : les partis continuent (DeepSeek payant, puis titres bruts) ;
  // les autres fils s'arrêtent et reprennent au prochain passage.
  let gratuitVide = false, payantVide = false, bruts = 0, payes = 0;
  for (const src of sources || []) {
    if (arret && src.entity_type !== "party") continue;
    const feed = await lireFlux(src);
    if (!feed) continue;
    const items = (feed.items || []).slice(0, 20);

    // URLs déjà connues pour cette entité (déduplication).
    const urls = items.map(i => i.link).filter(Boolean) as string[];
    const known = new Set<string>();
    if (urls.length) {
      const { data: existing } = await supabase.from("entity_feed")
        .select("url").eq("entity_type", src.entity_type).eq("entity_id", src.entity_id).in("url", urls);
      for (const r of existing || []) known.add(r.url);
    }
    // Titres récents de cette entité, toutes sources confondues : un même fait
    // repris par deux journaux (donc deux adresses) ne doit entrer qu'une fois.
    const { data: recents } = await supabase.from("entity_feed").select("title")
      .eq("entity_type", src.entity_type).eq("entity_id", src.entity_id)
      .gte("created_at", new Date(Date.now() - 10 * 86400000).toISOString()).limit(300);
    const titresRecents: string[] = (recents || []).map((r: any) => r.title).filter(Boolean);

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
      if (src.entity_type === "party" && (gratuitVide || arret)) {
        // Secours 2 : DeepSeek payant (quelques centimes par mois) ; secours 3 : titre brut.
        if (!payantVide) {
          try { ai = await summarise(src.entity_name, rawTitle, snippet, src.entity_type, true); payes++; }
          catch { payantVide = true; }
        }
        if (!ai) {
          if (!brutPubliable(rawTitle, src)) continue;
          ai = { should_publish: true, title: rawTitle.slice(0, 160), summary: snippet && !snippet.startsWith(rawTitle) ? snippet.slice(0, 220) : null, news_type: "actualite", brut: true };
          bruts++;
        }
      } else try { ai = await summarise(src.entity_name, rawTitle, snippet, src.entity_type); quotaVide = 0; }
      catch (e: any) {
        echecs++;
        // Toutes les lignées gratuites refusent : on laisse passer les pauses de 5 min
        // une fois ; si ça refuse encore, c'est le quota du JOUR — inutile d'insister.
        if (/Aucun modèle gratuit disponible/.test(String(e?.message))) {
          // Un parti n'attend pas : il passe tout de suite aux secours (payant, puis brut).
          if (src.entity_type === "party") { gratuitVide = true; continue; }
          if (++quotaVide >= 2) { arret = true; break; }
          console.warn("[Institution-News] Modèles gratuits tous saturés — pause de 5 min.");
          await sleep(300000);
        } else await sleep(500);
        continue;
      }
      if (!ai || ai.should_publish === false || !ai.title || (!ai.summary && !ai.brut)) continue;
      // Même fait, autre journal. Pas pour les ministères : leurs actes du Journal
      // officiel ont des intitulés récurrents (« Nomination … ») qui se ressemblent
      // sans se répéter.
      if (src.entity_type !== "ministry" && titresRecents.some(t => quasiDoublon(t, ai.title, src.entity_name))) continue;

      // Le lieu : la commune elle-même pour un fil de commune ; pour un fil de
      // département ou de région, la commune que l'IA a lue dans l'article, ou le
      // territoire — précédé de la commune citée, « Mâcon (Saône-et-Loire) »,
      // quand une décision départementale vise un lieu précis.
      const territorial = src.entity_type === "department" || src.entity_type === "region";
      const surUneCommune = territorial && ai.portee === "commune";
      const lieu = typeof ai.lieu === "string" && ai.lieu.trim() ? ai.lieu.trim().slice(0, 80) : null;
      const place = src.entity_type === "commune" ? src.entity_name
        : !territorial ? null
        : surUneCommune ? lieu
        : lieu && lieu !== src.entity_name ? `${lieu} (${src.entity_name})` : src.entity_name;
      const row = {
        entity_type: src.entity_type, entity_id: src.entity_id,
        source_name: src.source_name, source_kind: src.kind,
        url: link, title: ai.title, summary: ai.summary,
        news_type: ai.news_type || "actualite", topic: null,
        published_at: pub ? pub.toISOString() : null,
        place,
        place_scope: src.entity_type === "commune" || surUneCommune ? "commune" : territorial ? "territoire" : null,
      };
      const { error: upErr } = await supabase.from("entity_feed").upsert(row, { onConflict: "entity_type,entity_id,url" });
      if (upErr) { console.warn("upsert:", upErr.message); continue; }
      titresRecents.push(ai.title);
      inserted++; perSource++;
    }
  }
  console.log(`[Institution-News] Terminé. ${scanned} items analysés (LLM), ${inserted} publiés, ${echecs} échec(s) de l'IA.`);
  if (payes || bruts) console.log(`[Institution-News] Partis en secours : ${payes} résumé(s) DeepSeek payant, ${bruts} titre(s) publié(s) sans IA.`);
  if (arret) console.log("::warning::Quota gratuit du jour épuisé : passage interrompu, reprise au prochain.");
  else if (scanned >= 10 && echecs > scanned / 2) console.log(`::warning::${echecs} résumés sur ${scanned} ont échoué : le fil est à l'arrêt.`);
  return inserted;
}

if (process.argv[1]) syncInstitutionNews().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
