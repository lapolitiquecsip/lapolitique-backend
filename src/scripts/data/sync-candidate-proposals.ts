import "dotenv/config";
import crypto from "crypto";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Propositions / idées de chaque candidat, à partir du site OFFICIEL de son mouvement.
// On RESTRUCTURE le texte officiel en idées claires par thème (fidèle, aucune invention) via
// deepseek-chat, + un CONTEXTE (« pourquoi ce thème ») tiré du texte. Garde-fou anti-coût :
// on ne relance l'IA que si les données du candidat ont plus de FRESH_DAYS (proposals stables).
// FORCE_PROPOSALS=1 force la régénération.
const PROGRAMS: Record<string, { base: string; index: string }> = {
  "david lisnard": { base: "https://www.unenouvelleenergie.fr", index: "/notre-programme/" },
  // NB Mélenchon (L'Avenir en Commun) : programme publié mais site SPA JS + PDF → non scrapable
  // par simple fetch. À traiter par parsing PDF (avenir_en_commun_2025.pdf) plus tard.
};
const MAX_PAGES = Number(process.env.PROPOSALS_MAX_PAGES || 24);   // borne le coût IA par candidat
const FRESH_DAYS = Number(process.env.PROPOSALS_FRESH_DAYS || 7);
const FORCE = process.argv.includes("--force") || process.env.FORCE_PROPOSALS === "1";
const CONTEXT_MARK = "__contexte__";

const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const NOISE = /(recevez|newsletter|s'engager|s’engager|participer|proposer vos idées|faire un don|adhérer|adherer|rejoignez|mentions légales|abonnez|suivez-nous|cookies)/i;

async function fetchDoc(url: string): Promise<cheerio.CheerioAPI | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)" }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) { console.warn(`  ! HTTP ${res.status} ${url}`); return null; }
    return cheerio.load(await res.text());
  } catch (e: any) { console.warn(`  ! ${url} : ${e.message}`); return null; }
}

// Texte brut du programme d'une page thème (titres + paragraphes + listes), avant la FAQ.
function pageText($: cheerio.CheerioAPI): { theme: string; text: string } {
  const theme = ($("h1").first().text().trim() || "").slice(0, 80);
  const parts: string[] = [];
  let stopped = false;
  $("h2, h3, h4, p, li").each((_, el) => {
    if (stopped) return;
    const tag = (el as any).tagName;
    const t = $(el).text().replace(/\s+/g, " ").replace(/[↓↑]/g, "").trim();
    if (!t || NOISE.test(t)) return;
    if (tag === "h2" && /les questions qu|recevez les actualit/i.test(t)) { stopped = true; return; }
    if (t.length < 8) return;
    parts.push((tag === "h3" || tag === "h2" ? `\n## ${t}` : t));
  });
  return { theme, text: parts.join("\n").slice(0, 9000) };
}

const SYS = `On te donne le TEXTE d'une page du PROGRAMME OFFICIEL d'un·e candidat·e à la présidentielle (thème indiqué). Tu le RESTRUCTURES en idées claires, SANS RIEN INVENTER ni ajouter le moindre fait absent du texte.

Réponds en JSON STRICT :
{
  "context": "1 à 2 phrases : le constat/l'objectif du candidat sur ce thème (POURQUOI il propose ça), repris fidèlement du texte. Neutre.",
  "proposals": ["chaque PROPOSITION/idée concrète du texte, une par entrée, formulée clairement (verbatim ou légèrement condensé), factuelle"]
}

RÈGLES : reste FIDÈLE au texte (aucune invention, aucun ajout, aucune opinion). Capture TOUTES les propositions concrètes présentes (vise l'exhaustivité). Chaque proposition = 1 phrase claire. Si le texte est purement introductif, "proposals" peut être court.`;

async function extractIdeas(theme: string, text: string): Promise<{ context: string | null; proposals: string[] }> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-chat", max_tokens: 3000, responseFormat: "json_object",
    system: SYS, messages: [{ role: "user", content: `THÈME : ${theme}\n\nTEXTE :\n${text}` }],
  }, { timeoutMs: 90000 });
  const t = resp.content[0]?.text ?? "";
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return { context: null, proposals: [] };
  try {
    const j = JSON.parse(m[0]);
    return {
      context: typeof j.context === "string" ? j.context.slice(0, 400) : null,
      proposals: Array.isArray(j.proposals) ? j.proposals.filter((p: any) => typeof p === "string" && p.trim().length > 8).map((p: string) => p.trim().slice(0, 320)) : [],
    };
  } catch { return { context: null, proposals: [] }; }
}

export async function syncCandidateProposals() {
  console.log(`--- SYNC PROPOSITIONS CANDIDATS (sites officiels)${FORCE ? " [FORCE]" : ""} ---`);
  const { data: candidates, error } = await supabase
    .from("presidential_candidates").select("id, full_name, normalized_name").eq("status", "declared");
  if (error) throw error;

  let totalCand = 0, totalProp = 0;
  for (const c of candidates ?? []) {
    const key = c.normalized_name || norm(c.full_name);
    const prog = PROGRAMS[key] || PROGRAMS[norm(c.full_name)];
    if (!prog) continue;

    // Garde-fou anti-coût IA : si des propositions récentes existent déjà, on saute.
    if (!FORCE) {
      const { data: fresh } = await supabase.from("candidate_proposals").select("updated_at")
        .eq("candidate_id", c.id).order("updated_at", { ascending: false }).limit(1);
      const last = fresh?.[0]?.updated_at ? new Date(fresh[0].updated_at).getTime() : 0;
      if (last && (Date.now() - last) < FRESH_DAYS * 86400000) { console.log(`> ${c.full_name} : à jour (< ${FRESH_DAYS} j), sauté.`); continue; }
    }

    const idx = await fetchDoc(prog.base + prog.index);
    if (!idx) continue;
    const themeUrls = new Set<string>();
    idx("a[href]").each((_, a) => {
      let h = (idx(a).attr("href") || "").split("#")[0].split("?")[0];
      if (!h) return;
      if (h.startsWith("/")) h = prog.base + h;
      if (!h.startsWith(prog.base + prog.index)) return;
      if (h.replace(/\/$/, "") === (prog.base + prog.index).replace(/\/$/, "")) return;
      if (!/pole-de-travail|idees\/?$/i.test(h)) themeUrls.add(h);
    });
    // Programme sur UNE SEULE page (pas de sous-pages thématiques) : on scrape la page elle-même.
    if (themeUrls.size === 0) themeUrls.add(prog.base + prog.index);

    const rows: any[] = [];
    let order = 0;
    for (const url of [...themeUrls].slice(0, MAX_PAGES)) {
      const doc = await fetchDoc(url);
      if (!doc) continue;
      const { theme, text } = pageText(doc);
      if (text.length < 100) continue;
      const { context, proposals } = await extractIdeas(theme, text);
      if (context) {
        rows.push({ id: crypto.createHash("md5").update(`${c.id}|ctx|${norm(theme)}`).digest("hex"),
          candidate_id: c.id, theme, subsection: CONTEXT_MARK, text: context, source_url: url, sort_order: order++, updated_at: new Date().toISOString() });
      }
      for (const p of proposals) {
        rows.push({ id: crypto.createHash("md5").update(`${c.id}|${norm(p)}`).digest("hex"),
          candidate_id: c.id, theme, subsection: null, text: p, source_url: url, sort_order: order++, updated_at: new Date().toISOString() });
      }
      await new Promise(r => setTimeout(r, 300));
    }
    // Dédoublonnage par id (une même proposition peut apparaître dans 2 pages/chapitres).
    const uniq = Array.from(new Map(rows.map(r => [r.id, r])).values());
    if (uniq.length) {
      // Régénération propre : on remplace l'ancien jeu (les IDs changent si le texte change).
      await supabase.from("candidate_proposals").delete().eq("candidate_id", c.id);
      const { error: e } = await supabase.from("candidate_proposals").upsert(uniq, { onConflict: "id" });
      if (e) { console.error(`  ! upsert ${c.full_name}: ${e.message}`); continue; }
    }
    console.log(`> ${c.full_name} : ${uniq.length} entrée(s) depuis ${Math.min(themeUrls.size, MAX_PAGES)} page(s).`);
    totalCand++; totalProp += uniq.length;
  }
  console.log(`--- TERMINE. ${totalCand} candidat(s), ${totalProp} entrée(s). ---`);
  return totalProp;
}

if (process.argv[1] && process.argv[1].endsWith("sync-candidate-proposals.ts")) {
  syncCandidateProposals().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
