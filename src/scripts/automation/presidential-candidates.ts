import "dotenv/config";
import Parser from "rss-parser";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

const parser = new Parser({ timeout: 15000 });

// Version du schéma de bio : incrémenter force la régénération des fiches existantes.
const BIO_VERSION = 8;

// Flux d'actualité politique pour détecter les déclarations de candidature.
const NEWS_FEEDS = [
  "https://www.lemonde.fr/politique/rss_full.xml",
  "https://www.lefigaro.fr/rss/figaro_politique.xml",
  "https://www.francetvinfo.fr/politique.rss",
  "https://services.lesechos.fr/rss/les-echos-politique.xml",
  // Recherche ciblée « présidentielle 2027 » (Google News FR)
  "https://news.google.com/rss/search?q=%22pr%C3%A9sidentielle+2027%22+candidat+candidature&hl=fr&gl=FR&ceid=FR:fr",
];

function normalizeName(value: string): string {
  return value
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function slugify(value: string): string {
  return value
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

type Detected = {
  full_name: string;
  party?: string;
  political_side?: string;
  category?: string;
  declared_at?: string | null;
  confidence: number;
  source_url?: string;
  // Résumé factuel de repli quand la personne n'a pas d'article Wikipédia (aucune bio inventée).
  fallback_summary?: string;
  // Photo de repli (URL Wikimedia Commons sous licence libre) quand pas d'article Wikipédia.
  fallback_photo?: string;
  fallback_photo_credit?: string;
};

// Socle vérifié des candidat·e·s OFFICIELLEMENT déclaré·e·s à la PRÉSIDENTIELLE 2027
// (source : Wikipédia « Élection présidentielle française de 2027 »). Ce socle garantit
// une base exacte ; la détection presse ajoute automatiquement les nouveaux déclarés.
const CANDIDATE_SEED: Detected[] = [
  { full_name: "Marine Le Pen", party: "Rassemblement National", political_side: "extreme-droite", declared_at: "2023-09-18", confidence: 1 },
  { full_name: "Jean-Luc Mélenchon", party: "La France Insoumise", political_side: "gauche", declared_at: "2026-05-03", confidence: 1 },
  { full_name: "Édouard Philippe", party: "Horizons", political_side: "centre", declared_at: "2024-09-03", confidence: 1 },
  { full_name: "Gabriel Attal", party: "Renaissance", political_side: "centre", declared_at: "2026-05-22", confidence: 1 },
  { full_name: "Bruno Retailleau", party: "Les Républicains", political_side: "droite", declared_at: "2026-04-19", confidence: 1 },
  { full_name: "Xavier Bertrand", party: "Les Républicains", political_side: "droite", declared_at: "2024-02-03", confidence: 1 },
  { full_name: "Nicolas Dupont-Aignan", party: "Debout la France", political_side: "droite", declared_at: "2025-03-08", confidence: 1 },
  { full_name: "Florian Philippot", party: "Les Patriotes", political_side: "extreme-droite", declared_at: "2026-05-09", confidence: 1 },
  { full_name: "François Asselineau", party: "Union populaire républicaine", political_side: "autre", declared_at: "2023-08-31", confidence: 1 },
  { full_name: "Juan Branco", party: "Les Ruches", political_side: "autre", declared_at: "2024-12-21", confidence: 1 },
  { full_name: "Delphine Batho", party: "Génération écologie", political_side: "gauche", declared_at: "2025-11-25", confidence: 1 },
  { full_name: "Jérôme Guedj", party: "Parti Socialiste", political_side: "gauche", declared_at: "2026-02-05", confidence: 1 },
  { full_name: "Karim Bouamrane", party: "Parti Socialiste", political_side: "gauche", declared_at: "2026-06-09", confidence: 1 },
  { full_name: "Nathalie Arthaud", party: "Lutte ouvrière", political_side: "extreme-gauche", declared_at: "2025-12-08", confidence: 1 },
  { full_name: "Anasse Kazib", party: "Révolution permanente", political_side: "extreme-gauche", declared_at: "2026-06-01", confidence: 1 },
  { full_name: "Selma Labib", party: "NPA – Révolutionnaires", political_side: "extreme-gauche", declared_at: "2026-06-17", confidence: 1,
    fallback_summary: "Selma Labib, porte-parole du NPA-Révolutionnaires et conductrice de bus en région parisienne, est la candidate de son parti à l'élection présidentielle de 2027 (en binôme avec Gaël Quirante). Il s'agit de la troisième candidature d'extrême gauche déclarée, après Nathalie Arthaud et Anasse Kazib.",
    fallback_photo: "https://commons.wikimedia.org/wiki/Special:FilePath/Presidentielles-2027-Selma-LABIB.png?width=600", fallback_photo_credit: "Wikimedia Commons · CC BY 3.0" },
];

// Candidat·e·s de PRIMAIRE — déclaré·e·s à une primaire (gauche unitaire, socialiste, droite),
// pas directement à la présidentielle. Inclus·e·s à la demande de l'éditeur, mais SIGNALÉ·E·S
// comme tel·le·s via `category` (« Primaire … ») pour rester honnête. Un seul·e ira au scrutin.
const PRIMARY_SEED: Detected[] = [
  { full_name: "Marine Tondelier", party: "Les Écologistes", political_side: "gauche", category: "Primaire de la gauche unitaire", declared_at: null, confidence: 1 },
  { full_name: "François Ruffin", party: "Debout !", political_side: "gauche", category: "Primaire de la gauche unitaire", declared_at: null, confidence: 1 },
  { full_name: "Lydie Massard", party: "Union démocratique bretonne", political_side: "gauche", category: "Primaire de la gauche unitaire", declared_at: null, confidence: 1,
    fallback_summary: "Lydie Massard, responsable de l'Union démocratique bretonne (UDB), est candidate à la primaire de la gauche unitaire en vue de l'élection présidentielle de 2027." },
  { full_name: "Ségolène Royal", party: "Parti socialiste", political_side: "gauche", category: "Primaire socialiste", declared_at: null, confidence: 1 },
  { full_name: "Philippe Brun", party: "Parti socialiste", political_side: "gauche", category: "Primaire socialiste", declared_at: null, confidence: 1 },
  { full_name: "David Lisnard", party: "Nouvelle Énergie", political_side: "droite", category: "Primaire de la droite", declared_at: null, confidence: 1 },
];

// Personnes à EXCLURE : faux positifs de la détection presse. (Les candidat·e·s de primaire ne
// sont plus exclu·e·s : ils/elles sont désormais intégré·e·s via PRIMARY_SEED avec un label.)
const EXCLUDED_NAMES = new Set<string>([]);

// ---- 1. Rassembler les extraits d'actualité récents -----------------------
async function gatherHeadlines(): Promise<string> {
  const lines: string[] = [];
  for (const url of NEWS_FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      for (const item of feed.items.slice(0, 25)) {
        const snippet = (item.contentSnippet || item.summary || "").slice(0, 200);
        lines.push(`- ${item.title} — ${snippet} (${item.link})`);
      }
    } catch (err: any) {
      console.warn(`[Presidential] Flux illisible ${url}: ${err.message}`);
    }
  }
  return lines.join("\n").slice(0, 18000);
}

// ---- 2. Détecter les candidats DÉCLARÉS (grounded, anti-rumeur) -----------
async function detectCandidates(headlines: string): Promise<Detected[]> {
  const response = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 4000,
    responseFormat: "json_object",
    system: `Tu analyses des extraits d'actualité politique française pour identifier les personnes ayant OFFICIELLEMENT DÉCLARÉ leur candidature à l'élection présidentielle française de 2027.

RÈGLES STRICTES :
- N'inclus une personne QUE si les extraits indiquent explicitement qu'elle S'EST DÉCLARÉE candidate à l'élection PRÉSIDENTIELLE elle-même (a annoncé/officialisé sa candidature à la présidentielle).
- EXCLIS ABSOLUMENT les candidats à une PRIMAIRE (primaire socialiste, primaire écologiste, primaire d'un parti…) : être candidat à une primaire n'est PAS être candidat à la présidentielle. Ex. « X est candidat à la primaire socialiste » → NE PAS inclure.
- EXCLIS toute personne seulement « pressentie », « probable », « qui pourrait », « envisagerait », « tentée », « conditionnelle » : ce ne sont PAS des candidats déclarés.
- N'invente aucun nom qui n'apparaît pas dans les extraits.
- confidence : 0.9-1 si déclaration explicite claire, 0.6-0.8 si probable mais formulé comme une déclaration, <0.6 sinon (à exclure).

Réponds en JSON strict : { "candidates": [ { "full_name": "...", "party": "...", "political_side": "gauche|centre|droite|extreme-gauche|extreme-droite|autre", "declared_at": "YYYY-MM-DD ou null", "confidence": 0.0, "source_url": "..." } ] }`,
    messages: [{ role: "user", content: `Extraits d'actualité :\n\n${headlines}` }],
  }, { timeoutMs: 90000 });
  const text = response.content[0]?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  const parsed = JSON.parse(match[0]);
  return (parsed.candidates ?? []).filter((c: Detected) => c.full_name && c.confidence >= 0.6);
}

// ---- 3. Grounding Wikipédia : photo + texte de référence ------------------
async function wikipediaData(name: string): Promise<{ extract: string; photo?: string; url?: string }> {
  const headers = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
  try {
    const res = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`, {
      headers, signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { extract: "" };
    const data: any = await res.json();
    if (data.type === "disambiguation") return { extract: "" };

    // Article complet en texte brut (grounding détaillé de la bio).
    let extract = data.extract || "";
    try {
      const title = data.title || name;
      const full = await fetch(
        `https://fr.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`,
        { headers, signal: AbortSignal.timeout(12000) },
      );
      if (full.ok) {
        const json: any = await full.json();
        const page: any = Object.values(json?.query?.pages ?? {})[0];
        if (page?.extract && page.extract.length > extract.length) extract = page.extract;
      }
    } catch { /* on garde le résumé court en repli */ }

    return {
      extract,
      photo: data.originalimage?.source || data.thumbnail?.source,
      url: data.content_urls?.desktop?.page,
    };
  } catch {
    return { extract: "" };
  }
}

// ---- 4. Structurer la bio À PARTIR du texte Wikipédia (aucune invention) --
async function structureBio(name: string, reference: string) {
  const response = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 24000,   // modèle à raisonnement : les tokens de raisonnement consomment le budget → grande marge pour les bios les plus longues (Mélenchon, Philippe…)
    responseFormat: "json_object",
    system: `Tu produis une biographie TRÈS DÉTAILLÉE et rigoureusement FACTUELLE, UNIQUEMENT à partir du texte de référence Wikipédia fourni. N'invente RIEN qui ne soit dans le texte.

NEUTRALITÉ ABSOLUE (impératif) :
- Aucun jugement de valeur, ni positif ni négatif. Décris uniquement des FAITS.
- N'emploie AUCUN qualificatif idéologique ou étiquette d'auto-description (ex: NE PAS écrire « gaulliste », « figure de la gauche radicale », « souverainiste convaincu », « héritier de… »). Reste neutre et descriptif.
- Pas d'adjectifs évaluatifs (« brillant », « controversé », « emblématique »…). Faits, dates, fonctions, chiffres.

EXIGENCES :
- Sois EXHAUSTIF et PRÉCIS : dates exactes, chiffres, pourcentages, noms propres, lieux, intitulés de fonctions.
- Chaque rubrique est un TABLEAU de points. Mets PLUSIEURS points dès que l'information existe (vise 3 à 8 points).
- Si une rubrique est réellement absente du texte, renvoie un tableau vide [].

Réponds en JSON strict :
{
  "summary": "accroche 1-2 phrases, strictement factuelle et neutre",
  "naissance": { "date": "AAAA-MM-JJ (ou AAAA si jour inconnu)", "ville": "ville de naissance", "pays": "pays de naissance", "pays_code": "code ISO 3166-1 alpha-2 en minuscules, ex: fr, sn, dz" },
  "profession": "métier d'origine avant/hors politique, 2-4 mots (ex: Avocate, Médecin). Sinon \"\"",
  "formation": "école ou diplôme le plus notable, 1-4 mots (ex: ENA, Sciences Po, HEC). Sinon \"\"",
  "enfants": "nombre d'enfants si mentionné, ex: \"4 enfants\". Sinon \"\"",
  "famille": ["..."],
  "parents": ["profession et parcours du père", "profession et parcours de la mère", "fratrie..."],
  "etudes": ["diplômes, écoles, années"],
  "parcours": ["TOUTES les fonctions politiques exercées depuis le début de la carrière politique, une par point, avec l'intitulé EXACT de la fonction et les dates (début–fin). Ex: \"1986-1988 : sénateur de l'Essonne\". Liste-les dans l'ordre chronologique, sois exhaustif."],
  "jobs": ["UNIQUEMENT les expériences professionnelles HORS politique (métiers, emplois réels), avec dates, classées dans l'ORDRE CHRONOLOGIQUE (du plus ancien au plus récent). AUCUNE fonction élective ou politique ici."],
  "publications": ["livres, essais, articles, tribunes ou journaux ÉCRITS/PUBLIÉS par la personne, avec titre et année si connus. Si aucun, renvoie []"],
  "passions": ["hobbies et centres d'intérêt PERSONNELS NON politiques : sports, arts, musique, loisirs, etc. Pas d'engagements politiques. Si aucun, []"],
  "faits_marquants": ["événements marquants avec dates/chiffres, factuels"],
  "realisations": ["Pour chaque fonction politique exercée, les actions CONCRÈTES menées (lois, réformes, décisions, créations, budgets, mesures) — en précisant SOUS QUELLE FONCTION et à QUELLE DATE. Ex: \"Ministre X (2012-2014) : a créé/porté/voté …\". Strictement factuel, sans jugement de valeur."],
  "positions": ["principales propositions et positions programmatiques, formulées de façon neutre et factuelle (ce que la personne propose), sans les valoriser ni les critiquer"],
  "controverses": ["affaires, mises en cause ou condamnations, avec dates et faits précis, sans jugement de valeur"],
  "chronologie": ["AAAA : événement clé", "AAAA : événement clé"]
}`,
    messages: [{ role: "user", content: `Personne : ${name}\n\nTexte de référence :\n${reference.slice(0, 35000)}` }],
  }, { timeoutMs: 150000 });
  const text = (response.content[0]?.text ?? "").replace(/```json\s*|\s*```/g, "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) { console.warn(`[Presidential] Pas de JSON pour ${name} (réponse vide/tronquée, ignoré).`); return null; }
  try {
    return JSON.parse(match[0]);
  } catch (err: any) {
    console.warn(`[Presidential] JSON de bio invalide pour ${name} (ignoré): ${err.message}`);
    return null;
  }
}

// ---- 4bis. Positions fortes tirées de TOUT le web (Tavily) ----------------
// La rubrique "positions" de Wikipédia est souvent pauvre. On interroge le web
// pour récupérer ce que le·la candidat·e a réellement DÉCLARÉ comme positions fortes,
// puis DeepSeek les reformule de façon neutre et factuelle (aucune invention).
const TAVILY_KEY = process.env.TAVILY_API_KEY || "";
const deacc = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, ""); // Tavily gère mal les accents
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function tavilySearch(query: string): Promise<string> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${TAVILY_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: deacc(query), max_results: 6, search_depth: "advanced", include_answer: true }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return "";
    const d: any = await res.json();
    const parts: string[] = [];
    if (d.answer) parts.push(`[Synthèse] ${d.answer}`);
    for (const r of (d.results || [])) {
      if (r.content) parts.push(`[${r.title || r.url}] ${String(r.content).replace(/\s+/g, " ").slice(0, 600)}`);
    }
    return parts.join("\n\n");
  } catch { return ""; }
}

async function webStrongPositions(name: string, party?: string | null): Promise<string[]> {
  if (!TAVILY_KEY) return [];
  const p = party ? ` (${party})` : "";
  const queries = [
    `${name}${p} programme presidentielle 2027 propositions principales`,
    `${name} positions declarations que defend il propose`,
    `${name} mesures phares campagne prises de position`,
  ];
  const blocks: string[] = [];
  for (const q of queries) { const t = await tavilySearch(q); if (t) blocks.push(t); await sleep(150); }
  const context = blocks.join("\n\n---\n\n");
  if (context.length < 200) return [];
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 3000,
    responseFormat: "json_object",
    system: `On te donne des EXTRAITS WEB (presse, programme, déclarations) sur un·e candidat·e à la présidentielle française. Extrais ses POSITIONS FORTES : ce qu'il·elle défend/propose réellement.

RÈGLES :
- UNIQUEMENT à partir des extraits. N'invente RIEN. Si un point n'est pas étayé, ne le mets pas.
- Chaque position = 1 phrase COURTE, factuelle et NEUTRE, décrivant ce que la personne propose ou défend (ex: « Propose d'abroger la réforme des retraites de 2023 », « Défend la sortie du nucléaire d'ici 2035 »).
- AUCUN jugement de valeur, aucun qualificatif idéologique, aucun adjectif évaluatif.
- Vise 6 à 12 positions marquantes et concrètes, couvrant des domaines variés (économie, social, régalien, écologie, international, institutions) selon ce que disent les extraits.
- Formule au présent, verbe d'action (« Propose… », « Défend… », « Veut… », « S'oppose à… », « Souhaite… »).

Réponds en JSON strict : { "positions": ["...", "..."] }`,
    messages: [{ role: "user", content: `Candidat·e : ${name}${p}\n\nEXTRAITS WEB :\n${context.slice(0, 45000)}` }],
  }, { timeoutMs: 120000 });
  const text = resp.content[0]?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]).positions;
    return Array.isArray(arr) ? arr.filter((s: any) => typeof s === "string" && s.trim().length > 5).slice(0, 12) : [];
  } catch { return []; }
}

// Enrichit bio.positions avec les positions fortes du web (remplace si le web en trouve).
async function enrichWebPositions(name: string, party: string | null | undefined, bio: any): Promise<void> {
  if (!bio) return;
  try {
    const web = await webStrongPositions(name, party);
    if (web.length) bio.positions = web;
  } catch (err: any) {
    console.warn(`[Presidential] positions web KO pour ${name}: ${err.message}`);
  }
}

// ---- Pipeline principal ---------------------------------------------------
export async function syncPresidentialCandidates() {
  // 0) Ré-enrichir les fiches existantes dont la bio n'a pas la structure détaillée
  //    (marqueur : présence de "chronologie"). Mise à jour en place, sans supprimer.
  const { data: allExisting } = await supabase
    .from("presidential_candidates")
    .select("id, full_name, normalized_name, party, bio");
  for (const row of allExisting ?? []) {
    if (row.bio && (row.bio as any)._v === BIO_VERSION) continue; // déjà à jour
    try {
      const wiki = await wikipediaData(row.full_name);
      if (!wiki.extract) continue;
      const bio = await structureBio(row.full_name, wiki.extract);
      if (!bio) continue;
      await enrichWebPositions(row.full_name, (row as any).party, bio); // positions fortes tirées du web
      await supabase.from("presidential_candidates").update({
        bio: { ...bio, _v: BIO_VERSION }, summary: bio.summary ?? null, updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      console.log(`[Presidential] ↻ Bio détaillée régénérée : ${row.full_name}`);
    } catch (err: any) {
      console.error(`[Presidential] Échec ré-enrichissement ${row.full_name}: ${err.message}`);
    }
  }

  // Nettoyage : retire les faux positifs (candidats à une primaire, etc.).
  for (const row of allExisting ?? []) {
    if (EXCLUDED_NAMES.has(row.normalized_name)) {
      await supabase.from("presidential_candidates").delete().eq("id", row.id);
      console.log(`[Presidential] ✗ Retiré (pas candidat à la présidentielle) : ${row.full_name}`);
    }
  }

  console.log("[Presidential] Détection des candidats 2027...");
  const headlines = await gatherHeadlines();
  const detectedRaw = await detectCandidates(headlines);
  // Socle vérifié + détection presse, en excluant les noms bannis.
  const bySlug = new Map<string, Detected>();
  for (const c of [...CANDIDATE_SEED, ...PRIMARY_SEED, ...detectedRaw]) {
    const n = normalizeName(c.full_name);
    if (!n || EXCLUDED_NAMES.has(n) || bySlug.has(n)) continue;
    bySlug.set(n, c);
  }
  const detected = [...bySlug.values()];
  console.log(`[Presidential] ${detected.length} candidat(s) déclaré(s) (socle + presse).`);

  // Corrige la `category` (label « Primaire … ») des candidat·e·s déjà en base.
  {
    const desiredCat = new Map(detected.filter(c => c.category).map(c => [normalizeName(c.full_name), c.category!]));
    const { data: existingCat } = await supabase.from("presidential_candidates").select("id, normalized_name, category");
    for (const row of existingCat ?? []) {
      const want = desiredCat.get(row.normalized_name);
      if (want && row.category !== want) {
        await supabase.from("presidential_candidates").update({ category: want }).eq("id", row.id);
        console.log(`[Presidential] ⟳ Label primaire : ${row.normalized_name} → ${want}`);
      }
    }
  }

  const known = new Set((allExisting ?? []).filter(row => !EXCLUDED_NAMES.has(row.normalized_name)).map(row => row.normalized_name));

  let added = 0;
  for (const candidate of detected) {
    const normalized = normalizeName(candidate.full_name);
    if (!normalized || known.has(normalized)) continue;

    const wiki = await wikipediaData(candidate.full_name);
    // Sans article Wikipédia : on insère quand même à partir des faits vérifiés du socle
    // (parti, camp, résumé de repli sourcé), sans bio structurée inventée.
    if (!wiki.extract && !candidate.fallback_summary) {
      console.warn(`[Presidential] Pas de fiche Wikipédia ni de résumé de repli pour ${candidate.full_name}, ignoré.`);
      continue;
    }
    const bio = wiki.extract ? await structureBio(candidate.full_name, wiki.extract) : null;
    if (bio) await enrichWebPositions(candidate.full_name, candidate.party, bio); // positions fortes tirées du web

    const { error } = await supabase.from("presidential_candidates").insert({
      slug: slugify(candidate.full_name),
      full_name: candidate.full_name,
      normalized_name: normalized,
      party: candidate.party ?? null,
      political_side: candidate.political_side ?? null,
      category: candidate.category ?? "Chef de file",
      status: "declared",
      declared_at: candidate.declared_at || null,
      photo_url: wiki.photo ?? candidate.fallback_photo ?? null,
      photo_credit: wiki.photo ? "Wikimedia Commons" : (candidate.fallback_photo ? (candidate.fallback_photo_credit ?? "Wikimedia Commons") : null),
      summary: bio?.summary ?? candidate.fallback_summary ?? null,
      bio: bio ? { ...bio, _v: BIO_VERSION } : null,
      source_urls: [candidate.source_url, wiki.url].filter(Boolean),
      confidence: candidate.confidence,
    });
    if (error) { console.error(`[Presidential] Insert ${candidate.full_name}:`, error.message); continue; }
    known.add(normalized);
    added++;
    console.log(`[Presidential] ✓ Ajouté : ${candidate.full_name}`);
  }

  console.log(`[Presidential] Terminé. ${added} nouveau(x) candidat(s).`);
  return added;
}

if (process.argv[1] && process.argv[1].endsWith("presidential-candidates.ts")) {
  syncPresidentialCandidates().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
