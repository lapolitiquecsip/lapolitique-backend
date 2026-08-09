import "dotenv/config";
import AdmZip from "adm-zip";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { ISSUES } from "./seed-issues.js";

// Phase 3.2 — "Ce qu'il DIT" : positions déclaratives des députés depuis les QUESTIONS ÉCRITES
// (open data AN). Rattachement par IDENTIFIANT OFFICIEL (auteur.acteurRef = PA… → deputies.an_id),
// donc AUCUN risque d'homonyme. Tag par enjeu (mots-clés sur rubrique + analyse). Regroupement par
// (député, enjeu). En mode écriture : DeepSeek condense un résumé de ce qu'il a interrogé/défendu +
// stance PRUDENTE (souvent 'inconnu' pour des questions) ; evidence = analyses + liens (extraits courts).
//
// Modes : défaut = ÉCHANTILLON À SEC (aucun LLM, aucune écriture) ; POSITIONS_WRITE=1 = génère+écrit.

const ZIP_URL = "https://data.assemblee-nationale.fr/static/openData/repository/17/questions/questions_ecrites/Questions_ecrites.json.zip";
const deacc = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MIN_ITEMS = 2;          // on ne crée une position que si l'élu a ≥2 questions sur l'enjeu (substance)
const MAX_EVIDENCE = 6;

// Un enjeu matche si un de ses mots-clés apparaît dans le texte court (rubrique + analyse).
const ISSUE_RE = ISSUES.map(i => ({ slug: i.slug, res: i.keywords.map(k => new RegExp(`\\b${esc(deacc(k))}\\b`)) }));
const ISSUE_LABEL = Object.fromEntries(ISSUES.map(i => [i.slug, i.title]));
function tagText(text: string): string[] {
  const t = deacc(text);
  return ISSUE_RE.filter(i => i.res.some(re => re.test(t))).map(i => i.slug);
}

const arr = (x: any) => (Array.isArray(x) ? x : x ? [x] : []);
const questionUrl = (numero: string) => `https://questions.assemblee-nationale.fr/q17/17-${numero}QE.htm`;

async function main() {
  const write = process.env.POSITIONS_WRITE === "1";
  const limit = Number(process.env.POSITIONS_LIMIT ?? 0); // limite le nb de (député,enjeu) traités (validation)

  // 1) Députés : map acteurRef (an_id) -> slug
  const { data: deps, error } = await supabase.from("deputies").select("an_id, slug, first_name, last_name");
  if (error) throw error;
  const byId = new Map((deps || []).filter(d => d.an_id && d.slug).map(d => [d.an_id, d]));
  console.log(`Députés: ${byId.size}`);

  // 2) Télécharge + dézippe les questions écrites
  console.log("Téléchargement des questions écrites AN…");
  const buf = Buffer.from(await (await fetch(ZIP_URL, { signal: AbortSignal.timeout(120000) })).arrayBuffer());
  const entries = new AdmZip(buf).getEntries().filter(e => /\.json$/.test(e.entryName));
  console.log(`${entries.length} questions.`);

  // 3) Tag + regroupement par (député, enjeu)
  type Item = { analyse: string; url: string; date: string | null };
  const groups = new Map<string, { slug: string; issue: string; name: string; items: Item[] }>();
  let matchedAuthors = 0;
  for (const e of entries) {
    let q: any;
    try { q = JSON.parse((e.getData() as Buffer).toString("utf8")).question; } catch { continue; }
    const ref = q?.auteur?.identite?.acteurRef;
    const dep = ref && byId.get(ref);
    if (!dep) continue;
    matchedAuthors++;
    const rubrique = q?.indexationAN?.rubrique || "";
    const analyse = q?.indexationAN?.analyses?.analyse || q?.indexationAN?.teteAnalyse || rubrique;
    const issuesHit = tagText(`${rubrique} ${analyse}`);
    if (!issuesHit.length) continue;
    const numero = q?.identifiant?.numero || "";
    const date = q?.minAttribs?.minAttrib?.infoJO?.dateJO || null;
    for (const issue of issuesHit) {
      const key = `${dep.slug}|${issue}`;
      let g = groups.get(key);
      if (!g) { g = { slug: dep.slug, issue, name: `${dep.first_name} ${dep.last_name}`, items: [] }; groups.set(key, g); }
      g.items.push({ analyse, url: questionUrl(numero), date });
    }
  }
  const eligible = [...groups.values()].filter(g => g.items.length >= MIN_ITEMS);
  console.log(`Questions rattachées à un député: ${matchedAuthors} · paires (député,enjeu): ${groups.size} · éligibles (≥${MIN_ITEMS}): ${eligible.length}`);

  // ---- ÉCHANTILLON À SEC ----
  if (!write) {
    const byIssue: Record<string, number> = {};
    for (const g of eligible) byIssue[g.issue] = (byIssue[g.issue] || 0) + 1;
    console.log("\nPositions par enjeu (nb de députés):", JSON.stringify(byIssue));
    console.log("\n===== ÉCHANTILLON (député × enjeu) =====");
    for (const g of eligible.sort((a, b) => b.items.length - a.items.length).slice(0, 20)) {
      console.log(`• ${g.name} — ${ISSUE_LABEL[g.issue]} [${g.items.length} questions]`);
      for (const it of g.items.slice(0, 3)) console.log(`    · ${it.analyse}`);
    }
    console.log("\n(mode à sec : aucun LLM, aucune écriture)");
    return;
  }

  // ---- GÉNÉRATION + ÉCRITURE ----
  // Incrémental (cron hebdo) : on saute les paires déjà générées (sauf POSITIONS_INCREMENTAL=0).
  let done = new Set<string>();
  if (process.env.POSITIONS_INCREMENTAL === "1") {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("entity_positions").select("entity_id, issue_slug").eq("entity_type", "deputy").range(from, from + 999);
      if (!data || !data.length) break;
      for (const r of data) done.add(`${r.entity_id}|${r.issue_slug}`);
      if (data.length < 1000) break;
    }
  }
  const targets = (limit > 0 ? eligible.slice(0, limit) : eligible).filter(g => !done.has(`${g.slug}|${g.issue}`));
  let written = 0;
  for (const g of targets) {
    const evidence = g.items.slice(0, MAX_EVIDENCE).map(it => ({ type: "question", url: it.url, date: it.date, excerpt: it.analyse }));
    const list = g.items.slice(0, 12).map(it => `- ${it.analyse}`).join("\n");
    let summary = "", stance = "inconnu";
    try {
      const resp = await resilientDeepSeek.createMessage({
        model: "deepseek-v4-flash", max_tokens: 1200, responseFormat: "json_object",
        system: `À partir des intitulés de QUESTIONS ÉCRITES posées au gouvernement par un·e député·e sur l'enjeu « ${ISSUE_LABEL[g.issue]} », résume factuellement CE QUE l'élu·e met en avant / sur quoi il ou elle interpelle le gouvernement.
RÈGLES : n'invente rien au-delà des intitulés ; 2-3 phrases (50 mots max). "stance" = 'inconnu' par défaut (une question n'est pas une prise de position pour/contre) ; n'utilise 'pour'/'contre'/'nuance' QUE si les intitulés expriment clairement une orientation. Réponds en JSON : { "summary": "...", "stance": "inconnu" }`,
        messages: [{ role: "user", content: `Enjeu : ${ISSUE_LABEL[g.issue]}\nQuestions :\n${list}` }],
      });
      const raw = resp.content[0]?.type === "text" ? resp.content[0].text : "";
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { const p = JSON.parse(m[0]); summary = p.summary || ""; if (["pour", "contre", "nuance", "inconnu"].includes(p.stance)) stance = p.stance; }
    } catch { /* on écrit quand même l'evidence, stance inconnu */ }

    const row = {
      entity_type: "deputy", entity_id: g.slug, issue_slug: g.issue,
      stance, summary, evidence, source_type: "question", confidence: 0.7, updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("entity_positions").upsert(row, { onConflict: "entity_type,entity_id,issue_slug" });
    if (error) { console.error("upsert:", error.message); continue; }
    written++;
    if (written % 50 === 0) console.log(`… ${written} positions écrites`);
  }
  console.log(`Terminé. ${written} positions déclaratives écrites.`);
}

main().catch(e => { console.error(e); process.exit(1); });
