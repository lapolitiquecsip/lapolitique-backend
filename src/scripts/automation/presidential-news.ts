import "dotenv/config";
import Parser from "rss-parser";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

const parser = new Parser({ timeout: 15000 });
const MAX_ITEMS_PER_CANDIDATE = 5;

// Résume une actualité concernant un candidat, avec valeur ajoutée et classification.
async function summariseNews(candidate: string, title: string, snippet: string) {
  const response = await resilientDeepSeek.createMessage({
    // deepseek-chat (non-raisonneur) : appelé en boucle sur chaque actu → bien moins cher
    // et pas de risque de troncature par raisonnement (flash pouvait rendre un JSON vide).
    model: "deepseek-chat",
    max_tokens: 1200,
    responseFormat: "json_object",
    system: `Tu alimentes le fil d'actualité d'un candidat à la présidentielle 2027 (${candidate}). À partir du titre et de l'extrait d'un article, produis une entrée courte et à valeur ajoutée.

RÈGLES :
- "should_publish" = false si l'article ne concerne PAS réellement ${candidate}, ou n'a aucun intérêt informatif.
- "title" : titre reformulé, factuel, accrocheur (max 14 mots).
- "summary" : 1-2 phrases (40 mots max), avec un fait/chiffre concret si présent. En français.
- "news_type" : un parmi interview | soutien | programme | declaration | sondage | actualite.

Réponds en JSON strict : { "should_publish": true, "title": "...", "summary": "...", "news_type": "actualite" }`,
    messages: [{ role: "user", content: `Candidat : ${candidate}\nTitre : ${title}\nExtrait : ${snippet}` }],
  });
  const text = response.content[0]?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

function sourceFromTitle(title: string): { clean: string; source: string } {
  // Google News formate souvent « Titre - Source ».
  const idx = title.lastIndexOf(" - ");
  if (idx > 0) return { clean: title.slice(0, idx).trim(), source: title.slice(idx + 3).trim() };
  return { clean: title.trim(), source: "" };
}

// Solde DeepSeek disponible ? (léger, ne déclenche pas le garde-fou qui coupe le process).
async function deepseekAvailable(): Promise<boolean> {
  try {
    const r = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return false;
    return !!(await r.json()).is_available;
  } catch { return false; }
}

export async function syncPresidentialNews() {
  const { data: candidates, error } = await supabase
    .from("presidential_candidates")
    .select("id, full_name")
    .eq("status", "declared");
  if (error) throw error;
  // Si le solde IA est épuisé, on continue quand même en MODE BRUT (titre + extrait, sans
  // reformulation) : le fil ne s'arrête plus jamais. L'IA n'est utilisée que si du crédit existe.
  const aiOn = await deepseekAvailable();
  console.log(`[Presidential-News] ${candidates?.length ?? 0} candidat(s). IA : ${aiOn ? "activée" : "épuisée → mode brut"}.`);

  let inserted = 0;
  for (const candidate of candidates ?? []) {
    const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${candidate.full_name}"`)}&hl=fr&gl=FR&ceid=FR:fr`;
    let feed;
    try {
      feed = await parser.parseURL(feedUrl);
    } catch (err: any) {
      console.warn(`[Presidential-News] Flux illisible pour ${candidate.full_name}: ${err.message}`);
      continue;
    }

    let processed = 0;
    for (const item of feed.items) {
      if (processed >= MAX_ITEMS_PER_CANDIDATE) break;
      const url = item.link;
      if (!url) continue;

      // Déduplication par (candidat, url).
      const { data: existing } = await supabase
        .from("candidate_news")
        .select("id")
        .eq("candidate_id", candidate.id)
        .eq("source_url", url)
        .maybeSingle();
      if (existing) continue;

      const { clean, source } = sourceFromTitle(item.title || "");
      const snippet = (item.contentSnippet || item.content || "").slice(0, 500);

      try {
        let row: { title: string; summary: string | null; news_type: string };
        if (aiOn) {
          const summary = await summariseNews(candidate.full_name, clean, snippet);
          if (!summary || summary.should_publish === false) continue;
          row = { title: summary.title || clean, summary: summary.summary || null, news_type: summary.news_type || "actualite" };
          await new Promise(r => setTimeout(r, 600));
        } else {
          // Mode brut (sans IA) : filtre minimal de pertinence (le nom du candidat dans le titre).
          const last = candidate.full_name.split(" ").pop()?.toLowerCase() || "";
          if (last && !clean.toLowerCase().includes(last)) continue;
          row = { title: clean, summary: snippet.slice(0, 200) || null, news_type: "actualite" };
        }

        const { error: insertError } = await supabase.from("candidate_news").insert({
          candidate_id: candidate.id,
          date: item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          title: row.title, summary: row.summary, news_type: row.news_type,
          source_name: source || "Presse", source_url: url,
        });
        if (insertError) { console.error(`[Presidential-News] insert:`, insertError.message); continue; }
        processed++;
        inserted++;
      } catch (cause: any) {
        console.error(`[Presidential-News] ${candidate.full_name}:`, cause.message);
      }
    }
    console.log(`[Presidential-News] ${candidate.full_name}: ${processed} actu(s).`);
  }

  console.log(`[Presidential-News] Terminé. ${inserted} actualité(s) insérée(s).`);
  return inserted;
}

if (process.argv[1] && process.argv[1].endsWith("presidential-news.ts")) {
  syncPresidentialNews().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
