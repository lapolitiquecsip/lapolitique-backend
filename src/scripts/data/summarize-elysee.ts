import "dotenv/config";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Résumés des comptes rendus du Conseil des ministres.
// On récupère le texte intégral publié sur elysee.fr, puis DeepSeek le résume en français
// simple. Objectif : que le lecteur comprenne ce qui a été décidé sans quitter le site ni
// déchiffrer le jargon administratif. Le texte source reste la seule matière du résumé —
// aucune interprétation extérieure.
const UA = "Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)";

async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, aside").remove();
  // Le corps de l'article ; on retombe sur <main> puis <body> si la structure change.
  const scope = $("article").length ? $("article") : ($("main").length ? $("main") : $("body"));
  return scope.text().replace(/\s+/g, " ").trim();
}

async function summarize(title: string, text: string): Promise<string | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-chat",
    // Modèle à raisonnement : prévoir le budget pour sa réflexion PUIS la réponse,
    // sinon le contenu revient vide sans erreur.
    max_tokens: 4000,
    system: `On te donne le COMPTE RENDU OFFICIEL d'un Conseil des ministres.

Résume-le en français simple, pour un citoyen non spécialiste.

RÈGLES :
- Ne te fonde QUE sur le texte fourni. N'ajoute aucune information extérieure.
- Structure en 3 à 6 puces, une par décision importante (projet de loi, décret, communication).
- Pour chaque puce : ce qui a été décidé, et ce que ça change concrètement.
- Ignore les nominations individuelles, sauf si elles concernent un poste majeur.
- Ton neutre et factuel. Aucun jugement politique, aucune formule d'introduction.

Réponds directement par les puces, chacune commençant par "- ".`,
    messages: [{ role: "user", content: `TITRE : ${title}\n\nCOMPTE RENDU :\n${text.slice(0, 18000)}` }],
  }, { timeoutMs: 180000 });

  const t = (resp.content?.[0]?.text ?? "").trim();
  return t.length > 40 ? t : null;
}

async function main() {
  console.log("--- RÉSUMÉS DES CONSEILS DES MINISTRES ---");
  const { data, error } = await supabase
    .from("elysee_publications")
    .select("id, title, url, summary")
    .eq("type", "conseil_ministres")
    .order("published_at", { ascending: false });
  if (error) throw error;

  // On ne repasse pas sur ceux déjà résumés (le résumé RSS d'origine est très court).
  const todo = (data ?? []).filter(p => !p.summary || p.summary.length < 200);
  console.log(`> ${data?.length ?? 0} comptes rendus, ${todo.length} à résumer.`);

  let ok = 0;
  for (const p of todo) {
    try {
      const text = await fetchPageText(p.url);
      if (text.length < 300) { console.warn(`  ! ${p.url} : texte trop court (${text.length}), ignoré.`); continue; }
      const summary = await summarize(p.title, text);
      if (!summary) { console.warn(`  ! ${p.url} : résumé vide, ignoré.`); continue; }
      const { error: upErr } = await supabase
        .from("elysee_publications")
        .update({ summary, updated_at: new Date().toISOString() })
        .eq("id", p.id);
      if (upErr) { console.warn("  ! update:", upErr.message); continue; }
      ok++;
      console.log(`  ✓ ${p.title.slice(0, 60)}`);
    } catch (e: any) {
      console.warn(`  ! ${p.url} : ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`--- TERMINE. ${ok}/${todo.length} résumés. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
