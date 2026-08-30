import "dotenv/config";
import crypto from "crypto";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";

// Propositions / idées de chaque candidat, scrapées VERBATIM du site OFFICIEL de son mouvement.
// Aucune reformulation, aucune IA, aucune invention : on stocke le texte officiel + le lien source.
// Pour ajouter un candidat : vérifier le site de son mouvement + la page « programme » et l'ajouter.
const PROGRAMS: Record<string, { base: string; index: string }> = {
  // clé = normalized_name du candidat
  "david lisnard": { base: "https://www.unenouvelleenergie.fr", index: "/notre-programme/" },
};

const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// Sections/paragraphes de navigation ou d'appel à l'action à IGNORER (pas des propositions).
const NOISE = /(recevez|actualit|newsletter|s'engager|s’engager|participer|découvrir|decouvrir|cookies|nous pose|proposer vos idées|faire un don|adhérer|adherer|rejoignez|inscri|mentions légales|©)/i;
const STOP = /(les questions qu|recevez les actualit)/i;
// Une PROPOSITION = phrase d'action commençant par un verbe à l'infinitif (mesure concrète),
// ex. « Supprimer… », « Exercer… », « Fixer… ». Évite la rhétorique et les titres d'accordéon.
const PROPOSAL = /^[A-ZÉÀÊÎÔ][a-zà-ÿ]+(er|ir|re)\b/;

async function fetchDoc(url: string): Promise<cheerio.CheerioAPI | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)" }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) { console.warn(`  ! HTTP ${res.status} ${url}`); return null; }
    return cheerio.load(await res.text());
  } catch (e: any) { console.warn(`  ! ${url} : ${e.message}`); return null; }
}

// Extrait les propositions d'une page thème : <p> substantiels sous les <h3>, avant la
// section « questions/actualités ». On garde le texte tel quel.
function extractProposals($: cheerio.CheerioAPI, source_url: string) {
  const theme = ($("h1").first().text().trim() || "").slice(0, 80) || null;
  const out: { theme: string | null; subsection: string | null; text: string }[] = [];
  let subsection: string | null = null;
  let stopped = false;
  const seen = new Set<string>();
  $("h2, h3, p, li").each((_, el) => {
    if (stopped) return;
    const tag = (el as any).tagName;
    const t = $(el).text().replace(/\s+/g, " ").replace(/[↓↑]/g, "").trim();
    if (!t) return;
    if (tag === "h2") { if (STOP.test(t)) stopped = true; return; }
    if (tag === "h3") { subsection = NOISE.test(t) ? subsection : t.slice(0, 120); return; }
    // <p>/<li> : ne garder que les vraies PROPOSITIONS (phrase d'action à l'infinitif).
    if (t.length < 20 || t.length > 320 || NOISE.test(t) || /\?$/.test(t)) return;
    if (!PROPOSAL.test(t)) return;
    const key = norm(t);
    if (seen.has(key)) return; seen.add(key);
    out.push({ theme, subsection, text: t });
  });
  return out.map(p => ({ ...p, source_url }));
}

export async function syncCandidateProposals() {
  console.log("--- SYNC PROPOSITIONS CANDIDATS (sites officiels) ---");
  const { data: candidates, error } = await supabase
    .from("presidential_candidates").select("id, full_name, normalized_name").eq("status", "declared");
  if (error) throw error;

  let totalCand = 0, totalProp = 0;
  for (const c of candidates ?? []) {
    const key = c.normalized_name || norm(c.full_name);
    const prog = PROGRAMS[key] || PROGRAMS[norm(c.full_name)];
    if (!prog) continue;

    const idx = await fetchDoc(prog.base + prog.index);
    if (!idx) continue;
    // Auto-découverte des pages thèmes (/notre-programme/xxx/), hors index & pages non-programmatiques.
    const themeUrls = new Set<string>();
    idx("a[href]").each((_, a) => {
      let h = (idx(a).attr("href") || "").split("#")[0].split("?")[0];
      if (!h) return;
      if (h.startsWith("/")) h = prog.base + h;
      if (!h.startsWith(prog.base + prog.index)) return;
      if (h.replace(/\/$/, "") === (prog.base + prog.index).replace(/\/$/, "")) return; // l'index
      if (/pole-de-travail|idees\/?$|propositions?\/?$/i.test(h) === false) themeUrls.add(h);
    });

    const rows: any[] = [];
    let order = 0;
    for (const url of themeUrls) {
      const doc = await fetchDoc(url);
      if (!doc) continue;
      for (const p of extractProposals(doc, url)) {
        rows.push({
          id: crypto.createHash("md5").update(`${c.id}|${norm(p.text)}`).digest("hex"),
          candidate_id: c.id, theme: p.theme, subsection: p.subsection, text: p.text,
          source_url: p.source_url, sort_order: order++, updated_at: new Date().toISOString(),
        });
      }
      await new Promise(r => setTimeout(r, 300));
    }
    if (rows.length) {
      const { error: e } = await supabase.from("candidate_proposals").upsert(rows, { onConflict: "id" });
      if (e) { console.error(`  ! upsert ${c.full_name}: ${e.message}`); continue; }
    }
    console.log(`> ${c.full_name} : ${rows.length} proposition(s) depuis ${themeUrls.size} page(s).`);
    totalCand++; totalProp += rows.length;
  }
  console.log(`--- TERMINE. ${totalCand} candidat(s), ${totalProp} proposition(s). ---`);
  return totalProp;
}

if (process.argv[1] && process.argv[1].endsWith("sync-candidate-proposals.ts")) {
  syncCandidateProposals().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
