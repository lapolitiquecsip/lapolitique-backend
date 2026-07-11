import "dotenv/config";
import Parser from "rss-parser";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

const parser = new Parser({ timeout: 15000 });

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
    max_tokens: 1500,
    responseFormat: "json_object",
    system: `Tu analyses des extraits d'actualité politique française pour identifier les personnes ayant OFFICIELLEMENT DÉCLARÉ leur candidature à l'élection présidentielle française de 2027.

RÈGLES STRICTES :
- N'inclus une personne QUE si les extraits indiquent explicitement qu'elle S'EST DÉCLARÉE candidate (a annoncé/officialisé sa candidature).
- EXCLIS toute personne seulement « pressentie », « probable », « qui pourrait », « envisagerait », « tentée » : ce ne sont PAS des candidats déclarés.
- N'invente aucun nom qui n'apparaît pas dans les extraits.
- confidence : 0.9-1 si déclaration explicite claire, 0.6-0.8 si probable mais formulé comme une déclaration, <0.6 sinon (à exclure).

Réponds en JSON strict : { "candidates": [ { "full_name": "...", "party": "...", "political_side": "gauche|centre|droite|extreme-gauche|extreme-droite|autre", "declared_at": "YYYY-MM-DD ou null", "confidence": 0.0, "source_url": "..." } ] }`,
    messages: [{ role: "user", content: `Extraits d'actualité :\n\n${headlines}` }],
  });
  const text = response.content[0]?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  const parsed = JSON.parse(match[0]);
  return (parsed.candidates ?? []).filter((c: Detected) => c.full_name && c.confidence >= 0.6);
}

// ---- 3. Grounding Wikipédia : photo + texte de référence ------------------
async function wikipediaData(name: string): Promise<{ extract: string; photo?: string; url?: string }> {
  try {
    const res = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`, {
      headers: { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { extract: "" };
    const data: any = await res.json();
    if (data.type === "disambiguation") return { extract: "" };
    return {
      extract: data.extract || "",
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
    max_tokens: 1800,
    responseFormat: "json_object",
    system: `Tu structures une biographie UNIQUEMENT à partir du texte de référence fourni (issu de Wikipédia). N'ajoute AUCUNE information absente du texte. Si une rubrique est inconnue, mets une chaîne vide. Réponds en JSON strict :
{
  "summary": "accroche 1 phrase",
  "famille": "...", "parents": "...", "etudes": "...", "parcours": "...",
  "jobs": "...", "passions": "...", "faits_marquants": "...",
  "sorties_mediatiques": "...", "realisations": "..."
}`,
    messages: [{ role: "user", content: `Personne : ${name}\n\nTexte de référence :\n${reference.slice(0, 12000)}` }],
  });
  const text = response.content[0]?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

// ---- Pipeline principal ---------------------------------------------------
export async function syncPresidentialCandidates() {
  console.log("[Presidential] Détection des candidats 2027...");
  const headlines = await gatherHeadlines();
  const detected = await detectCandidates(headlines);
  console.log(`[Presidential] ${detected.length} candidat(s) déclaré(s) détecté(s).`);

  const { data: existing } = await supabase.from("presidential_candidates").select("normalized_name");
  const known = new Set((existing ?? []).map(row => row.normalized_name));

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
      bio: bio ?? null,
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
