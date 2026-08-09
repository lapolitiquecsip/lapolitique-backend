import "dotenv/config";
import AdmZip from "adm-zip";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { ISSUES } from "./seed-issues.js";

// Phase 3.2 — 2e source de PAROLE : les AMENDEMENTS des députés (open data AN).
// Rattachement par signataires.auteur.acteurRef (= PA… → deputies.an_id) → ZÉRO homonyme.
// Un amendement = une proposition concrète + un exposé sommaire (argument) + un sort (adopté/rejeté)
// → signal de POSITION plus net que les questions. On FUSIONNE avec les positions existantes
// (questions) : evidence combinée, résumé régénéré à partir des deux sources.
// Modes : défaut = échantillon à sec ; POSITIONS_WRITE=1 = fusion+écriture ; POSITIONS_INCREMENTAL=1.

const ZIP_URL = "https://data.assemblee-nationale.fr/static/openData/repository/17/loi/amendements_div_legis/Amendements.json.zip";
const deacc = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MIN_ITEMS = 2, MAX_EVIDENCE = 8;

const ISSUE_RE = ISSUES.map(i => ({ slug: i.slug, res: i.keywords.map(k => new RegExp(`\\b${esc(deacc(k))}\\b`)) }));
const ISSUE_LABEL = Object.fromEntries(ISSUES.map(i => [i.slug, i.title]));
const tagText = (t: string) => { const x = deacc(t); return ISSUE_RE.filter(i => i.res.some(re => re.test(x))).map(i => i.slug); };

// Nettoie l'exposé (HTML + entités &#xNN;/&#NN;), tronque court (extrait, droit d'auteur).
function cleanExpose(html: string): string {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ").trim();
}

async function main() {
  const write = process.env.POSITIONS_WRITE === "1";
  const limit = Number(process.env.POSITIONS_LIMIT ?? 0);

  const { data: deps, error } = await supabase.from("deputies").select("an_id, slug, first_name, last_name");
  if (error) throw error;
  const byId = new Map((deps || []).filter(d => d.an_id && d.slug).map(d => [d.an_id, d]));

  console.log("Téléchargement des amendements AN (~300 Mo)…");
  const buf = Buffer.from(await (await fetch(ZIP_URL, { signal: AbortSignal.timeout(180000) })).arrayBuffer());
  const entries = new AdmZip(buf).getEntries().filter(e => /\.json$/.test(e.entryName));
  console.log(`${entries.length} amendements.`);

  type Item = { excerpt: string; sort: string | null; url: string };
  const groups = new Map<string, { slug: string; issue: string; name: string; items: Item[]; seen: Set<string> }>();
  let matched = 0;
  for (const e of entries) {
    let a: any;
    try { a = JSON.parse((e.getData() as Buffer).toString("utf8")).amendement; } catch { continue; }
    const au = a?.signataires?.auteur;
    if (!au || au.typeAuteur !== "Député") continue;
    const dep = au.acteurRef && byId.get(au.acteurRef);
    if (!dep) continue;
    const expose = cleanExpose(a?.corps?.contenuAuteur?.exposeSommaire || "");
    if (expose.length < 40) continue;
    matched++;
    const issuesHit = tagText(expose.slice(0, 600));
    if (!issuesHit.length) continue;
    const sr = a?.cycleDeVie?.sort; const sort = typeof sr === "string" ? sr : null;
    const uid = a?.uid || "";
    const excerpt = expose.slice(0, 160);
    for (const issue of issuesHit) {
      const key = `${dep.slug}|${issue}`;
      let g = groups.get(key);
      if (!g) { g = { slug: dep.slug, issue, name: `${dep.first_name} ${dep.last_name}`, items: [], seen: new Set() }; groups.set(key, g); }
      const dk = deacc(excerpt).slice(0, 60);
      if (g.seen.has(dk)) continue; // dédup exposés identiques (amendements en série)
      g.seen.add(dk);
      g.items.push({ excerpt, sort, url: uid ? `https://www.assemblee-nationale.fr/dyn/17/amendements/${uid}` : "" });
    }
  }
  const eligible = [...groups.values()].filter(g => g.items.length >= MIN_ITEMS);
  console.log(`Amendements rattachés (député): ${matched} · paires: ${groups.size} · éligibles (≥${MIN_ITEMS}): ${eligible.length}`);

  if (!write) {
    const byIssue: Record<string, number> = {};
    for (const g of eligible) byIssue[g.issue] = (byIssue[g.issue] || 0) + 1;
    console.log("\nPar enjeu (nb députés):", JSON.stringify(byIssue));
    console.log("\n===== ÉCHANTILLON (député × enjeu) =====");
    for (const g of eligible.sort((a, b) => b.items.length - a.items.length).slice(0, 16)) {
      console.log(`• ${g.name} — ${ISSUE_LABEL[g.issue]} [${g.items.length} amdts]`);
      for (const it of g.items.slice(0, 2)) console.log(`    · (${it.sort || "?"}) ${it.excerpt}`);
    }
    console.log("\n(mode à sec : aucun LLM, aucune écriture)");
    return;
  }

  // ---- FUSION + ÉCRITURE ----
  let doneSet = new Set<string>();
  if (process.env.POSITIONS_INCREMENTAL === "1") {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("entity_positions").select("entity_id, issue_slug, source_type").eq("entity_type", "deputy").range(from, from + 999);
      if (!data || !data.length) break;
      for (const r of data) if ((r.source_type || "").includes("amendement")) doneSet.add(`${r.entity_id}|${r.issue_slug}`);
      if (data.length < 1000) break;
    }
  }
  const targets = (limit > 0 ? eligible.slice(0, limit) : eligible).filter(g => !doneSet.has(`${g.slug}|${g.issue}`));
  let written = 0;
  for (const g of targets) {
    // Fusionne avec la position existante (questions) si elle existe.
    const { data: existRows } = await supabase.from("entity_positions").select("summary, evidence, source_type").eq("entity_type", "deputy").eq("entity_id", g.slug).eq("issue_slug", g.issue).limit(1);
    const exist = existRows?.[0];
    const qEvidence = Array.isArray(exist?.evidence) ? exist!.evidence.filter((e: any) => e?.type === "question") : [];
    const amdEvidence = g.items.slice(0, MAX_EVIDENCE).map(it => ({ type: "amendement", url: it.url, sort: it.sort, excerpt: it.excerpt }));
    const evidence = [...qEvidence, ...amdEvidence].slice(0, MAX_EVIDENCE);

    const qList = qEvidence.slice(0, 6).map((e: any) => `- (question) ${e.excerpt}`).join("\n");
    const aList = g.items.slice(0, 8).map(it => `- (amendement, ${it.sort || "?"}) ${it.excerpt}`).join("\n");
    let summary = "", stance = "inconnu";
    try {
      const resp = await resilientDeepSeek.createMessage({
        model: "deepseek-v4-flash", max_tokens: 1300, responseFormat: "json_object",
        system: `À partir des QUESTIONS écrites et surtout des AMENDEMENTS déposés par un·e député·e sur l'enjeu « ${ISSUE_LABEL[g.issue]} », résume factuellement CE QUE l'élu·e défend.
RÈGLES : n'invente rien au-delà des éléments fournis ; 2-3 phrases (55 mots max). Un amendement est une proposition CONCRÈTE : tu peux en déduire une "stance" ('pour'/'contre'/'nuance') SI la direction est claire ; sinon 'inconnu'. Rédige STRICTEMENT en français. Réponds en JSON : { "summary": "...", "stance": "inconnu" }`,
        messages: [{ role: "user", content: `Enjeu : ${ISSUE_LABEL[g.issue]}\nAmendements :\n${aList}\n${qList ? "Questions :\n" + qList : ""}` }],
      });
      const raw = resp.content[0]?.type === "text" ? resp.content[0].text : "";
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { const p = JSON.parse(m[0]); summary = p.summary || exist?.summary || ""; if (["pour", "contre", "nuance", "inconnu"].includes(p.stance)) stance = p.stance; }
    } catch { summary = exist?.summary || ""; }

    const source_type = qEvidence.length ? "question+amendement" : "amendement";
    const { error } = await supabase.from("entity_positions").upsert(
      { entity_type: "deputy", entity_id: g.slug, issue_slug: g.issue, stance, summary, evidence, source_type, confidence: 0.7, updated_at: new Date().toISOString() },
      { onConflict: "entity_type,entity_id,issue_slug" });
    if (error) { console.error("upsert:", error.message); continue; }
    written++;
    if (written % 50 === 0) console.log(`… ${written}`);
  }
  console.log(`Terminé. ${written} positions (fusion questions+amendements) écrites.`);
}

main().catch(e => { console.error(e); process.exit(1); });
