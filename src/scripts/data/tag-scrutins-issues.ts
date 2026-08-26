import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { ISSUES } from "./seed-issues.js";

// Fondation Brique #3 (3.1) — Tag des scrutins par ENJEU (les "actes").
//
// Les 12 540 scrutins sont surtout des amendements/articles : leur seul contenu utile est le
// TITRE DE LA LOI visée. On REGROUPE donc les scrutins par loi (sujet extrait de l'objet) et on
// tague chaque loi UNE fois, puis on propage à tous ses scrutins → précision + coût LLM divisé.
//
// Décision par loi :
//   1) DÉTERMINISTE seulement sur des expressions TRÈS spécifiques (mots-clés multi-mots) → 0.9 ;
//   2) sinon LLM CONSERVATEUR : 0 à 2 enjeux, liste VIDE si rien de net (on préfère un vote non
//      classé à un vote mal classé). On N'UTILISE PAS la colonne `category` (grossière/peu fiable).
//
// Modes : SCRUTIN_TAG_SAMPLE=N → N lois distinctes, à sec (n'écrit rien) ; SCRUTIN_TAG_WRITE=1 → écrit.

const DISPLAY_THRESHOLD = 0.7;
const deacc = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Regex des SEULS mots-clés multi-mots (expressions spécifiques) pour le déterministe.
const PHRASE_RE = ISSUES.map(i => ({
  slug: i.slug,
  res: i.keywords.filter(k => k.includes(" ")).map(k => new RegExp(`\\b${esc(deacc(k))}\\b`)),
}));
const ISSUE_LABEL = Object.fromEntries(ISSUES.map(i => [i.slug, i.title]));

type Tag = { issue_slug: string; confidence: number; method: "keyword" | "llm" };

// Extrait le "sujet de loi" de l'objet (thème réel), en retirant l'habillage amendement/procédure.
function lawSubject(objet: string, title: string): string {
  const s = objet || title || "";
  const m = s.match(/(projet de loi(?: constitutionnelle| organique| de finances| de financement[^,.]*)?|proposition de loi(?: constitutionnelle| organique)?|proposition de r[ée]solution)[^.]*/i);
  let sub = m ? m[0] : s;
  sub = sub.replace(/\([^)]*\)/g, " ").replace(/\b(premi[èe]re|nouvelle|deuxi[èe]me) lecture\b/gi, " ").replace(/examen prioritaire/gi, " ").replace(/\s+/g, " ").trim();
  return sub;
}

// Clé de regroupement UNIFIÉE : retire le type de doc (projet/proposition de loi…) et la
// ponctuation, pour que « projet de loi relatif à X » et le vote final « Relatif à X » se
// rejoignent dans le même groupe (tag cohérent + un seul appel LLM par loi).
function groupKey(subject: string): string {
  return deacc(subject)
    .replace(/\b(projet|proposition)\s+de\s+loi(\s+constitutionnelle|\s+organique|\s+de\s+finances[^ ]*|\s+de\s+financement[^ ]*)?/g, " ")
    .replace(/\bproposition\s+de\s+resolution\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/^\s*(l ?ensemble (du|de la|des)|ensemble (du|de la|des))\s+/, "")
    .replace(/\s+/g, " ").trim().slice(0, 120);
}

function phraseTags(text: string): Tag[] {
  const t = deacc(text);
  const out: Tag[] = [];
  for (const iss of PHRASE_RE) {
    if (iss.res.some(re => re.test(t))) out.push({ issue_slug: iss.slug, confidence: 0.9, method: "keyword" });
  }
  return out;
}

async function llmTags(subject: string, summary: string): Promise<Tag[]> {
  const list = ISSUES.map(i => `${i.slug} = ${i.title}`).join("\n");
  const text = [subject, summary].filter(Boolean).join(" — ").slice(0, 1200);
  const response = await resilientDeepSeek.createMessage({
    model: "deepseek-chat", max_tokens: 1500, responseFormat: "json_object",
    system: `Tu classes un TEXTE de loi français par ENJEU, à partir de cette liste fermée :
${list}

RÈGLES STRICTES :
- N'attribue un enjeu QUE si le texte le concerne réellement et principalement.
- 0 à 2 enjeux maximum. Si rien de net, si c'est procédural, ou si le thème n'est couvert par AUCUN enjeu de la liste, renvoie une liste VIDE. Mieux vaut aucun enjeu qu'un classement abusif.
- "confidence" entre 0 et 1 (ta certitude).
Réponds en JSON strict : { "issues": [ { "slug": "immigration", "confidence": 0.9 } ] }`,
    messages: [{ role: "user", content: `Texte de loi : ${text}` }],
  });
  const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return [];
  let parsed: any; try { parsed = JSON.parse(m[0]); } catch { return []; }
  const valid = new Set(ISSUES.map(i => i.slug));
  return (parsed.issues || []).filter((x: any) => valid.has(x.slug)).slice(0, 2)
    .map((x: any) => ({ issue_slug: x.slug, confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0.6)), method: "llm" as const }));
}

// Source multi-chambre : AN (table `scrutins`) ou Sénat (`legislative_scrutins`, chamber SENAT).
// On normalise vers { id, objet, title, summary } pour réutiliser tout le pipeline.
async function fetchScrutins(limitRows: number, source: "an" | "senate"): Promise<any[]> {
  const all: any[] = [];
  for (let from = 0; ; from += 1000) {
    const to = from + 999;
    let q = source === "senate"
      ? supabase.from("legislative_scrutins").select("id, title, explanation").eq("chamber", "SENAT").order("voted_at", { ascending: false })
      : supabase.from("scrutins").select("id, objet, title, summary").order("date_scrutin", { ascending: false });
    const { data, error } = await q.range(from, to);
    if (error) throw error;
    const rows = (data || []).map((r: any) => source === "senate"
      ? { id: r.id, objet: r.title, title: r.title, summary: r.explanation }
      : r);
    all.push(...rows);
    if (!data || data.length < 1000 || (limitRows && all.length >= limitRows)) break;
  }
  return all;
}

async function main() {
  const sample = Number(process.env.SCRUTIN_TAG_SAMPLE ?? 0);
  const write = process.env.SCRUTIN_TAG_WRITE === "1";
  const source: "an" | "senate" = process.env.TAG_SOURCE === "senate" ? "senate" : "an";

  // En échantillon on lit assez de scrutins pour former N lois distinctes ; sinon tout.
  const scrutins = await fetchScrutins(sample > 0 ? Math.max(4000, sample * 40) : 0, source);

  // Regroupement par sujet de loi.
  const groups = new Map<string, { subject: string; summary: string; ids: string[] }>();
  for (const s of scrutins) {
    const subject = lawSubject(s.objet || "", s.title || "");
    const key = groupKey(subject) || String(s.id);
    let g = groups.get(key);
    if (!g) { g = { subject, summary: "", ids: [] }; groups.set(key, g); }
    if (!g.summary && s.summary) g.summary = s.summary;
    g.ids.push(String(s.id));
  }
  // Incrémental (mode écriture) : on saute les lois dont TOUS les scrutins sont déjà taggés
  // → le backfill tague tout la 1re fois, les passages suivants ne coûtent que les nouveautés.
  let alreadyTagged = new Set<string>();
  if (sample === 0 && process.env.SCRUTIN_TAG_INCREMENTAL !== "0") {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("scrutin_issues").select("scrutin_id").range(from, from + 999);
      if (!data || !data.length) break;
      for (const r of data) alreadyTagged.add(r.scrutin_id);
      if (data.length < 1000) break;
    }
  }

  const groupList = [...groups.values()].filter(g => sample > 0 || !g.ids.every(id => alreadyTagged.has(id)));
  const targets = sample > 0 ? groupList.slice(0, sample) : groupList;
  console.log(`${scrutins.length} scrutins → ${groupList.length} lois distinctes${sample > 0 ? ` (échantillon : ${targets.length} lois)` : ""}.`);

  const stats = { laws: 0, tagged: 0, keyword: 0, llm: 0, byConf: { "≥0.9": 0, "0.7–0.9": 0, "<0.7": 0 } as Record<string, number>, scrutinsTagged: 0 };
  const preview: string[] = [];
  const rows: any[] = [];

  for (const g of targets) {
    stats.laws++;
    let tags = phraseTags(`${g.subject} ${g.summary}`);
    if (!tags.length) tags = await llmTags(g.subject, g.summary);
    if (!tags.length) {
      if (sample > 0 && preview.length < 80) preview.push(`• ${g.subject.slice(0, 100)}\n    → (aucun enjeu)`);
      continue;
    }
    stats.tagged++;
    stats.scrutinsTagged += g.ids.length;
    for (const t of tags) {
      if (t.method === "keyword") stats.keyword++; else stats.llm++;
      stats.byConf[t.confidence >= 0.9 ? "≥0.9" : t.confidence >= 0.7 ? "0.7–0.9" : "<0.7"]++;
      for (const id of g.ids) rows.push({ scrutin_id: id, issue_slug: t.issue_slug, confidence: t.confidence, method: t.method });
    }
    if (sample > 0 && preview.length < 80)
      preview.push(`• ${g.subject.slice(0, 100)}  [${g.ids.length} scrutins]\n    → ${tags.map(t => `${ISSUE_LABEL[t.issue_slug]} (${t.method[0]}·${t.confidence})`).join(", ")}`);
  }

  if (sample > 0) {
    console.log("\n===== ÉCHANTILLON (par loi) =====\n" + preview.join("\n"));
    console.log("\n===== RÉPARTITION =====");
    console.log(`Lois taguées : ${stats.tagged}/${stats.laws}  (→ ${stats.scrutinsTagged} scrutins couverts)`);
    console.log(`Décisions → déterministe: ${stats.keyword}  |  LLM: ${stats.llm}`);
    console.log(`Confidence → ${JSON.stringify(stats.byConf)}`);
    console.log(`Seuil d'affichage front recommandé : confidence >= ${DISPLAY_THRESHOLD}`);
    console.log("\n(mode à sec : rien n'a été écrit)");
    return;
  }

  if (write && rows.length) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("scrutin_issues").upsert(rows.slice(i, i + 500), { onConflict: "scrutin_id,issue_slug" });
      if (error) console.error("upsert:", error.message);
    }
    console.log(`Écrit : ${rows.length} tags sur ${stats.scrutinsTagged} scrutins (${stats.tagged} lois ; déterministe ${stats.keyword}, LLM ${stats.llm}).`);
  } else {
    console.log(`${rows.length} tags calculés (écriture off — SCRUTIN_TAG_WRITE=1 pour écrire).`);
  }
}

if (process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
