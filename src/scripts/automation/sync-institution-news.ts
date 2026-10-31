import "dotenv/config";
import Parser from "rss-parser";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { recouper, OFFICIEL } from "../../lib/recoupement.js";
import { quasiDoublon } from "../../lib/quasi-doublon.js";
import { chiffresDansTexte, lireArticle, mediaExclu, mediaReconnu, presseBing, verifierArticle } from "../../lib/verification-article.js";

// Brique #4 — Fil d'actualité par institution (ministères, départements).
// Flux gratuits (RSS officiels + Google News) → filtre heuristique (AVANT LLM, pour économiser
// les tokens) → résumé DeepSeek court → table entity_feed. Droit d'auteur : on ne stocke que le
// titre reformulé, un résumé de ≤40 mots et le lien — jamais le texte intégral. Quotidien (cron).
//
// CONTRÔLE (31/10/2026) : résumer un titre, c'est inventer ; l'« extrait » de Google Actualités n'est que
// le titre, et son lien est une redirection illisible. La presse vient donc d'abord de Bing (adresse
// réelle, date, vrai extrait). Partis : même contrôle complet que les candidats (verification-article) ;
// rien n'est publié sans lecture. Communes, départements, régions : lecture gratuite ; article lu =
// résumé autorisé (verifie_le) ; sinon le titre du journal, sans résumé.

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

/** Requêtes Bing d'une source : il ne comprend pas les requêtes composées de Google. */
function requetesBing(src: any): string[] {
  if (src.entity_type === "party") return termesRequete(src.feed_url).slice(0, 2).map(t => `"${t}"`);
  const motif = src.entity_type === "commune" ? " mairie" : src.entity_type === "department" ? " préfecture" : src.entity_type === "region" ? " conseil régional" : "";
  return [`"${src.entity_name}"${motif}`];
}

type Article0 = { link: string; title: string; snippet: string; date: string | null; reel: boolean };

/** Bing d'abord (adresses réelles), Google Actualités si Bing ne donne rien. */
async function lireFlux(src: any): Promise<Article0[]> {
  if (src.kind === "google_news") {
    const vus = new Map<string, Article0>();
    for (const q of requetesBing(src)) {
      for (const x of (await presseBing(q)) ?? []) vus.set(x.link, { link: x.link, title: x.title, snippet: x.snippet || "", date: x.date ?? null, reel: true });
    }
    if (vus.size) return [...vus.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }
  try {
    const f = await parser.parseURL(src.feed_url);
    return (f.items || []).map(i => ({ link: i.link || "", title: i.title || "", snippet: i.contentSnippet || i.content || "", date: i.isoDate ?? null, reel: src.kind !== "google_news" }));
  } catch { return []; }
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
  // Partis : articles refusés mémorisés, pour ne pas les relire à chaque passage.
  let lus = 0, refuses = 0;
  for (const src of sources || []) {
    if (arret) continue;
    const items = (await lireFlux(src)).slice(0, 20);
    if (!items.length) continue;

    // URLs déjà connues pour cette entité (déduplication).
    const urls = items.map(i => i.link).filter(Boolean) as string[];
    const known = new Set<string>();
    if (urls.length) {
      const { data: existing } = await supabase.from("entity_feed")
        .select("url").eq("entity_type", src.entity_type).eq("entity_id", src.entity_id).in("url", urls);
      for (const r of existing || []) known.add(r.url);
      if (src.entity_type === "party") {
        const { data: vus } = await supabase.from("controverses_articles_vus").select("url").in("url", urls.map(u => `parti:${src.entity_id}:${u}`));
        for (const r of vus || []) known.add(r.url.slice(`parti:${src.entity_id}:`.length));
      }
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
    let perSource = 0, luesSource = 0;
    for (const item of items) {
      if (perSource >= MAX_ITEMS_PER_SOURCE || luesSource >= 8) break;
      const link = item.link;
      if (!link || known.has(link)) continue;

      // Fraîcheur
      let pub = item.date ? new Date(item.date) : null;
      if (pub && (Date.now() - pub.getTime()) / 86400000 > freshDays) continue;

      const { title: rawTitle, source: mediaGoogle } = item.reel ? { title: item.title.replace(/^Accueil\b[^-]*-[^-]*-\s*/, "").trim(), source: "" } : cleanGoogleTitle(item.title);
      if (!rawTitle || rawTitle.length < 12) continue;
      const media = mediaGoogle || (item.reel ? mediaReconnu(link) || new URL(link).hostname.replace(/^www\./, "") : "");
      if (item.reel && mediaExclu(link)) continue;

      // PARTIS : seulement un article de média reconnu, lu et contrôlé. Lien Google illisible : écarté.
      if (src.entity_type === "party") {
        if (!item.reel || !mediaReconnu(link)) continue;
        luesSource++; lus++;
        let v;
        try { v = await verifierArticle(src.entity_name, rawTitle, link, { termes: termesRequete(src.feed_url), role: "parti politique français" }); }
        catch (e: any) { echecs++; console.warn(`[Institution-News] ${src.entity_name} : ${e.message}`); continue; }
        if (v.ok === false) {
          if (!/illisible|sans réponse/.test(v.motif)) { await supabase.from("controverses_articles_vus").upsert({ url: `parti:${src.entity_id}:${link}`, personne_cle: `parti:${src.entity_id}` }, { onConflict: "url" }); refuses++; }
          continue;
        }
        if (titresRecents.some(t => quasiDoublon(t, v.titre, src.entity_name))) continue;
        let recoupe: { etat: string; medias: string[] } | null = null;
        try { recoupe = await recouper(rawTitle, v.media); } catch { /* l'agent y reviendra */ }
        const { error: upErr } = await supabase.from("entity_feed").upsert({
          entity_type: src.entity_type, entity_id: src.entity_id, source_name: src.source_name, source_kind: src.kind,
          media: v.media, titre_origine: rawTitle.slice(0, 400), extrait_origine: item.snippet.slice(0, 500) || null,
          recoupement: recoupe?.etat ?? null, autres_medias: recoupe ? recoupe.medias.length : null, recoupe_le: recoupe ? new Date().toISOString() : null,
          url: link, title: v.titre, summary: v.resume, news_type: v.type, topic: null, published_at: v.date, place: null, place_scope: null,
          verifie_le: new Date().toISOString(), citation: v.citation,
        }, { onConflict: "entity_type,entity_id,url" });
        if (upErr) { console.warn("upsert:", upErr.message); continue; }
        titresRecents.push(v.titre); inserted++; perSource++;
        continue;
      }

      // Filtre heuristique AVANT LLM (surtout pour Google News : désambiguïsation). Sauté pour les
      // PARTIS (noms souvent ambigus + articles centrés sur le dirigeant) : l'IA tranche la pertinence.
      if (src.kind === "google_news" && src.entity_type !== "party" && !mentionsEntity(rawTitle, src.entity_name)) continue;

      scanned++;
      // Lecture gratuite de l'article. Le résumé ne s'écrit que sur le texte réellement lu.
      luesSource++;
      const article = item.reel && src.kind === "google_news" ? await lireArticle(link, { gratuit: true }) : null;
      if (article?.date) {
        pub = new Date(article.date);
        if ((Date.now() - pub.getTime()) / 86400000 > freshDays) continue;   // vieil article réindexé
      }
      const snippet = (article?.texte || item.snippet).slice(0, article ? 4000 : 500);
      let ai;
      try { ai = await summarise(src.entity_name, rawTitle, snippet, src.entity_type); quotaVide = 0; }
      catch (e: any) {
        echecs++;
        // Toutes les lignées gratuites refusent : on laisse passer les pauses de 5 min
        // une fois ; si ça refuse encore, c'est le quota du JOUR — inutile d'insister.
        if (/Aucun modèle gratuit disponible/.test(String(e?.message))) {
          if (++quotaVide >= 2) { arret = true; break; }
          console.warn("[Institution-News] Modèles gratuits tous saturés — pause de 5 min.");
          await sleep(300000);
        } else await sleep(500);
        continue;
      }
      // Presse non lue, ou résumé avec un chiffre absent du texte : le titre du journal, sans résumé.
      const presse = src.kind === "google_news";
      const lue = !!article && !!article.date && !!ai?.summary && chiffresDansTexte(`${ai.title} ${ai.summary}`, article.texte);
      if (ai && presse && !lue) { ai.title = rawTitle.slice(0, 160); ai.summary = null; ai.brut = true; }
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
      // D'où vient l'information, et qui d'autre la donne. Une source institutionnelle n'a
      // pas à être recoupée ; une information de presse l'est sur son titre d'ORIGINE (le
      // titre réécrit ne se retrouve chez personne). En cas de panne de la recherche, le
      // champ reste vide et l'agent recoupeur y reviendra.
      const dePresse = src.kind === "google_news" && !OFFICIEL.test(`${media} ${src.source_name ?? ""}`);
      let recoupement: { etat: string; medias: string[] } | null = dePresse ? null : { etat: "officiel", medias: [] };
      if (dePresse) { try { recoupement = await recouper(rawTitle, media); } catch { /* l'agent y reviendra */ } }
      const row = {
        entity_type: src.entity_type, entity_id: src.entity_id,
        source_name: src.source_name, source_kind: src.kind,
        media: media || null, titre_origine: rawTitle.slice(0, 400), extrait_origine: snippet || null,
        recoupement: recoupement?.etat ?? null, autres_medias: recoupement ? recoupement.medias.length : null,
        recoupe_le: recoupement ? new Date().toISOString() : null,
        url: link, title: ai.title, summary: ai.summary,
        news_type: ai.news_type || "actualite", topic: null,
        published_at: pub ? pub.toISOString() : null,
        place,
        place_scope: src.entity_type === "commune" || surUneCommune ? "commune" : territorial ? "territoire" : null,
        verifie_le: presse && lue ? new Date().toISOString() : null,
      };
      const { error: upErr } = await supabase.from("entity_feed").upsert(row, { onConflict: "entity_type,entity_id,url" });
      if (upErr) { console.warn("upsert:", upErr.message); continue; }
      titresRecents.push(ai.title);
      inserted++; perSource++;
    }
  }
  console.log(`[Institution-News] Terminé. ${scanned} items analysés (LLM), ${inserted} publiés, ${echecs} échec(s) de l'IA.`);
  if (lus) console.log(`[Institution-News] Partis : ${lus} article(s) lu(s), ${refuses} refusé(s) au contrôle.`);
  if (arret) console.log("::warning::Quota gratuit du jour épuisé : passage interrompu, reprise au prochain.");
  else if (scanned >= 10 && echecs > scanned / 2) console.log(`::warning::${echecs} résumés sur ${scanned} ont échoué : le fil est à l'arrêt.`);
  return inserted;
}

if (process.argv[1]) syncInstitutionNews().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
