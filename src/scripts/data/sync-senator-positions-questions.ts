import "dotenv/config";
import { parse } from "csv-parse/sync";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { ISSUES } from "./seed-issues.js";

// Phase 3.2 (Sénat) — "Ce qu'il dit" pour les SÉNATEURS, depuis les questions écrites/orales
// (open data Sénat, CSV des 12 derniers mois). Le CSV ne fournit PAS de matricule → rattachement
// par (Nom, Prénom) avec MATCH UNIQUE EXIGÉ (sinon on saute → pas de fausse attribution).
// Tag par enjeu (Titre + Thème), regroupement par (sénateur, enjeu), condensé DeepSeek prudent.
// Modes : défaut = échantillon à sec ; POSITIONS_WRITE=1 = génère+écrit ; POSITIONS_INCREMENTAL=1.

const CSV_URL = "https://data.senat.fr/data/questions/questions-depuis-un-an.csv";
const deacc = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MIN_ITEMS = 2, MAX_EVIDENCE = 6;

const ISSUE_RE = ISSUES.map(i => ({ slug: i.slug, res: i.keywords.map(k => new RegExp(`\\b${esc(deacc(k))}\\b`)) }));
const ISSUE_LABEL = Object.fromEntries(ISSUES.map(i => [i.slug, i.title]));
const tagText = (t: string) => { const x = deacc(t); return ISSUE_RE.filter(i => i.res.some(re => re.test(x))).map(i => i.slug); };
const nameKey = (last: string, first: string) => `${deacc(last)}|${deacc(first)}`;

async function main() {
  const write = process.env.POSITIONS_WRITE === "1";
  const limit = Number(process.env.POSITIONS_LIMIT ?? 0);

  // 1) Sénateurs : index (nom|prénom) -> slug, avec détection d'ambiguïté.
  const { data: sens, error } = await supabase.from("senators").select("slug, first_name, last_name");
  if (error) throw error;
  const byName = new Map<string, string | null>(); // null = ambigu (plusieurs sénateurs)
  for (const s of sens || []) {
    if (!s.slug || !s.last_name) continue;
    const k = nameKey(s.last_name, s.first_name || "");
    byName.set(k, byName.has(k) ? null : s.slug);
  }
  console.log(`Sénateurs: ${sens?.length ?? 0}`);

  // 2) CSV des questions (latin1, séparateur ';')
  const buf = Buffer.from(await (await fetch(CSV_URL, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
  const rows: string[][] = parse(buf.toString("latin1"), { delimiter: ";", relax_quotes: true, skip_empty_lines: true });
  const H = rows[0].map(deacc);
  const col = (name: string) => H.findIndex(h => h.includes(deacc(name)));
  const iNat = col("nature"), iTit = col("titre"), iNom = col("nom"), iPre = col("prenom"), iThe = col("theme"), iUrl = col("url"), iDate = col("date de publication");

  // 3) Tag + regroupement par (sénateur, enjeu)
  type Item = { titre: string; url: string; date: string | null };
  const groups = new Map<string, { slug: string; issue: string; name: string; items: Item[] }>();
  let matched = 0, ambiguous = 0;
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r]; if (!c || c.length <= iUrl) continue;
    const nature = (c[iNat] || "").toUpperCase();
    if (!["QE", "QG", "QO"].includes(nature)) continue;
    const k = nameKey(c[iNom] || "", c[iPre] || "");
    const slug = byName.get(k);
    if (slug === null) { ambiguous++; continue; }   // homonyme → on saute
    if (!slug) continue;
    matched++;
    const titre = c[iTit] || "", theme = c[iThe] || "";
    const issuesHit = tagText(`${theme} ${titre}`);
    if (!issuesHit.length) continue;
    for (const issue of issuesHit) {
      const key = `${slug}|${issue}`;
      let g = groups.get(key);
      if (!g) { g = { slug, issue, name: `${c[iPre]} ${c[iNom]}`.trim(), items: [] }; groups.set(key, g); }
      g.items.push({ titre, url: c[iUrl] || "", date: c[iDate] || null });
    }
  }
  const eligible = [...groups.values()].filter(g => g.items.length >= MIN_ITEMS);
  console.log(`Questions rattachées: ${matched} · ambiguës (sautées): ${ambiguous} · paires: ${groups.size} · éligibles (≥${MIN_ITEMS}): ${eligible.length}`);

  if (!write) {
    const byIssue: Record<string, number> = {};
    for (const g of eligible) byIssue[g.issue] = (byIssue[g.issue] || 0) + 1;
    console.log("\nPar enjeu (nb sénateurs):", JSON.stringify(byIssue));
    console.log("\n===== ÉCHANTILLON =====");
    for (const g of eligible.sort((a, b) => b.items.length - a.items.length).slice(0, 18)) {
      console.log(`• ${g.name} — ${ISSUE_LABEL[g.issue]} [${g.items.length}]`);
      for (const it of g.items.slice(0, 3)) console.log(`    · ${it.titre}`);
    }
    console.log("\n(mode à sec : aucun LLM, aucune écriture)");
    return;
  }

  // Incrémental
  let done = new Set<string>();
  if (process.env.POSITIONS_INCREMENTAL === "1") {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("entity_positions").select("entity_id, issue_slug").eq("entity_type", "senator").range(from, from + 999);
      if (!data || !data.length) break;
      for (const r of data) done.add(`${r.entity_id}|${r.issue_slug}`);
      if (data.length < 1000) break;
    }
  }
  const targets = (limit > 0 ? eligible.slice(0, limit) : eligible).filter(g => !done.has(`${g.slug}|${g.issue}`));
  let written = 0;
  for (const g of targets) {
    const evidence = g.items.slice(0, MAX_EVIDENCE).map(it => ({ type: "question", url: it.url, date: it.date, excerpt: it.titre }));
    const list = g.items.slice(0, 12).map(it => `- ${it.titre}`).join("\n");
    let summary = "", stance = "inconnu";
    try {
      const resp = await resilientDeepSeek.createMessage({
        model: "deepseek-chat", max_tokens: 1200, responseFormat: "json_object",
        system: `À partir des intitulés de QUESTIONS posées au gouvernement par un·e sénateur·rice sur l'enjeu « ${ISSUE_LABEL[g.issue]} », résume factuellement CE QUE l'élu·e met en avant / sur quoi il ou elle interpelle le gouvernement.
RÈGLES : n'invente rien au-delà des intitulés ; 2-3 phrases (50 mots max). "stance" = 'inconnu' par défaut ; 'pour'/'contre'/'nuance' seulement si les intitulés expriment clairement une orientation. Rédige le summary STRICTEMENT en français. Réponds en JSON : { "summary": "...", "stance": "inconnu" }`,
        messages: [{ role: "user", content: `Enjeu : ${ISSUE_LABEL[g.issue]}\nQuestions :\n${list}` }],
      });
      const raw = resp.content[0]?.type === "text" ? resp.content[0].text : "";
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { const p = JSON.parse(m[0]); summary = p.summary || ""; if (["pour", "contre", "nuance", "inconnu"].includes(p.stance)) stance = p.stance; }
    } catch { /* evidence conservée, stance inconnu */ }
    const row = { entity_type: "senator", entity_id: g.slug, issue_slug: g.issue, stance, summary, evidence, source_type: "question", confidence: 0.7, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("entity_positions").upsert(row, { onConflict: "entity_type,entity_id,issue_slug" });
    if (error) { console.error("upsert:", error.message); continue; }
    written++;
    if (written % 50 === 0) console.log(`… ${written}`);
  }
  console.log(`Terminé. ${written} positions sénateurs écrites.`);
}

main().catch(e => { console.error(e); process.exit(1); });
