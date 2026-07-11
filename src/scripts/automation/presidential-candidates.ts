import "dotenv/config";
import Parser from "rss-parser";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

const parser = new Parser({ timeout: 15000 });

// Version du schéma de bio : incrémenter force la régénération des fiches existantes.
const BIO_VERSION = 4;

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
};

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
- N'inclus une personne QUE si les extraits indiquent explicitement qu'elle S'EST DÉCLARÉE candidate (a annoncé/officialisé sa candidature).
- EXCLIS toute personne seulement « pressentie », « probable », « qui pourrait », « envisagerait », « tentée » : ce ne sont PAS des candidats déclarés.
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
    max_tokens: 8000,
    responseFormat: "json_object",
    system: `Tu produis une biographie TRÈS DÉTAILLÉE et rigoureusement FACTUELLE, UNIQUEMENT à partir du texte de référence Wikipédia fourni. N'invente RIEN qui ne soit dans le texte.

EXIGENCES :
- Sois EXHAUSTIF et PRÉCIS : dates exactes, chiffres, pourcentages, noms propres, lieux, intitulés de fonctions.
- Chaque rubrique est un TABLEAU de points (bullet points). Mets PLUSIEURS points par rubrique dès que l'information existe (vise 3 à 8 points quand c'est possible).
- Si une rubrique est réellement absente du texte, renvoie un tableau vide [].

Réponds en JSON strict :
{
  "summary": "accroche 1-2 phrases",
  "naissance": { "date": "AAAA-MM-JJ (ou AAAA si jour inconnu)", "ville": "ville de naissance", "pays": "pays de naissance", "pays_code": "code ISO 3166-1 alpha-2 en minuscules, ex: fr, sn, dz" },
  "famille": ["..."],
  "parents": ["profession et parcours du père", "profession et parcours de la mère", "fratrie..."],
  "etudes": ["diplômes, écoles, années"],
  "parcours": ["étapes de carrière politique, avec dates et fonctions"],
  "jobs": ["métiers exercés hors politique, avec dates"],
  "passions": ["hobbies et centres d'intérêt PERSONNELS et NON politiques uniquement : sports, arts, musique, lectures, loisirs, cuisine, animaux, voyages, etc. NE PAS mettre d'engagements ou de combats politiques ici. Si le texte n'en mentionne aucun, renvoie []"],
  "faits_marquants": ["événements marquants avec dates/chiffres"],
  "sorties_mediatiques": ["apparitions médiatiques notables, livres, émissions"],
  "realisations": ["actions/lois/réformes concrètes portées, avec dates"],
  "positions": ["principales idées, combats et positions politiques"],
  "controverses": ["affaires, polémiques, condamnations éventuelles, avec dates"],
  "chronologie": ["AAAA : événement clé", "AAAA : événement clé"]
}`,
    messages: [{ role: "user", content: `Personne : ${name}\n\nTexte de référence :\n${reference.slice(0, 45000)}` }],
  }, { timeoutMs: 150000 });
  const text = response.content[0]?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (err: any) {
    console.warn(`[Presidential] JSON de bio invalide pour ${name} (ignoré): ${err.message}`);
    return null;
  }
}

// ---- Pipeline principal ---------------------------------------------------
export async function syncPresidentialCandidates() {
  // 0) Ré-enrichir les fiches existantes dont la bio n'a pas la structure détaillée
  //    (marqueur : présence de "chronologie"). Mise à jour en place, sans supprimer.
  const { data: allExisting } = await supabase
    .from("presidential_candidates")
    .select("id, full_name, normalized_name, bio");
  for (const row of allExisting ?? []) {
    if (row.bio && (row.bio as any)._v === BIO_VERSION) continue; // déjà à jour
    try {
      const wiki = await wikipediaData(row.full_name);
      if (!wiki.extract) continue;
      const bio = await structureBio(row.full_name, wiki.extract);
      if (!bio) continue;
      await supabase.from("presidential_candidates").update({
        bio: { ...bio, _v: BIO_VERSION }, summary: bio.summary ?? null, updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      console.log(`[Presidential] ↻ Bio détaillée régénérée : ${row.full_name}`);
    } catch (err: any) {
      console.error(`[Presidential] Échec ré-enrichissement ${row.full_name}: ${err.message}`);
    }
  }

  console.log("[Presidential] Détection des candidats 2027...");
  const headlines = await gatherHeadlines();
  const detected = await detectCandidates(headlines);
  console.log(`[Presidential] ${detected.length} candidat(s) déclaré(s) détecté(s).`);

  const known = new Set((allExisting ?? []).map(row => row.normalized_name));

  let added = 0;
  for (const candidate of detected) {
    const normalized = normalizeName(candidate.full_name);
    if (!normalized || known.has(normalized)) continue;

    const wiki = await wikipediaData(candidate.full_name);
    if (!wiki.extract) {
      console.warn(`[Presidential] Pas de fiche Wikipédia fiable pour ${candidate.full_name}, ignoré.`);
      continue;
    }
    const bio = await structureBio(candidate.full_name, wiki.extract);

    const { error } = await supabase.from("presidential_candidates").insert({
      slug: slugify(candidate.full_name),
      full_name: candidate.full_name,
      normalized_name: normalized,
      party: candidate.party ?? null,
      political_side: candidate.political_side ?? null,
      category: candidate.category ?? "Chef de file",
      status: "declared",
      declared_at: candidate.declared_at || null,
      photo_url: wiki.photo ?? null,
      photo_credit: wiki.photo ? "Wikimedia Commons" : null,
      summary: bio?.summary ?? null,
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
