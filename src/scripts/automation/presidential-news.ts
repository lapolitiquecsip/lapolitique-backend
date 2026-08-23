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

export async function syncPresidentialNews() {
  const { data: candidates, error } = await supabase
    .from("presidential_candidates")
    .select("id, full_name")
    .eq("status", "declared");
  if (error) throw error;
  console.log(`[Presidential-News] ${candidates?.length ?? 0} candidat(s).`);

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
        const summary = await summariseNews(candidate.full_name, clean, snippet);
        if (!summary || summary.should_publish === false) continue;

        const { error: insertError } = await supabase.from("candidate_news").insert({
          candidate_id: candidate.id,
          date: item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          title: summary.title || clean,
          summary: summary.summary || null,
          news_type: summary.news_type || "actualite",
          source_name: source || "Presse",
          source_url: url,
        });
        if (insertError) { console.error(`[Presidential-News] insert:`, insertError.message); continue; }
        processed++;
        inserted++;
        await new Promise(r => setTimeout(r, 600));
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
