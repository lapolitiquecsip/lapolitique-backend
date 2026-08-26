import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Moteur de preuves partagé par les scripts d'évaluation du programme présidentiel.
// Extrait de assess-program-grounded.ts pour éviter la duplication.
const MANDATE_START = "2022-05-14";   // début du second quinquennat
const TOP_EVIDENCE = 8;               // preuves soumises au modèle par engagement

// Seuls les scrutins qui tranchent réellement le sort d'un texte. Les votes d'amendements
// et d'articles (l'écrasante majorité) sont du bruit procédural pour notre usage.
const DECISIVE = /^\s*(l'ensemble|la motion|la déclaration|la declaration|la première partie|la premiere partie|la seconde partie|la proposition de résolution|la proposition de resolution)/i;

export type Ev = { type: string; title: string; date: string | null; url: string | null; detail?: string | null };

// Mots vides : sans ce filtre, les engagements se ressembleraient tous.
const STOP = new Set(`a au aux avec ce ces dans de des du elle en et eux il ils je la le les leur
lui ma mais me meme mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur
ta te tes toi ton tu un une vos votre vous y d l n s c j plus tout tous toute toutes etre avoir
faire fait sera seront nous allons pourra pourront afin ainsi entre chaque leurs cette cet aussi
sans sous vers dont lorsque quand comme deja encore plusieurs tres bien
france francais francaise francaises nouveau nouvelle mettre place mise`.split(/\s+/));

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const terms = (s: string) =>
  norm(s).split(" ").filter(w => w.length > 3 && !STOP.has(w));

async function fetchAll(table: string, select: string, filter?: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(select).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Corpus de preuves : uniquement des faits postérieurs au début du mandat.
export async function loadEvidenceCorpus(): Promise<Ev[]> {
  const scrutins = await fetchAll(
    "scrutins",
    "objet,title,date_scrutin,resultat,dossier_url,institution",
    q => q.gte("date_scrutin", MANDATE_START)
  );
  const dossiers = await fetchAll(
    "legislative_dossiers",
    "title,status_label,latest_step_at,source_urls,text_type",
    q => q.gte("latest_step_at", MANDATE_START)
  );

  const ev: Ev[] = [];
  let skipped = 0;
  for (const s of scrutins) {
    const title = (s.objet || s.title || "").trim();
    if (!title) continue;
    // 87 % des scrutins sont des votes d'amendements ou d'articles : ils citent le sujet
    // mais ne disent RIEN de l'aboutissement d'un engagement, et noieraient les vraies
    // preuves. On ne garde que les votes décisifs : ensemble du texte, motions, déclarations.
    if (!DECISIVE.test(title)) { skipped++; continue; }
    ev.push({
      type: "scrutin",
      title,
      date: s.date_scrutin ?? null,
      url: s.dossier_url ?? null,
      detail: s.resultat ? `Résultat : ${s.resultat}` : null,
    });
  }
  console.log(`> Scrutins : ${ev.length} retenus (votes décisifs), ${skipped} écartés (amendements/articles).`);
  for (const d of dossiers) {
    const title = (d.title || "").trim();
    if (!title) continue;
    ev.push({
      type: "dossier",
      title,
      date: d.latest_step_at ? String(d.latest_step_at).slice(0, 10) : null,
      url: Array.isArray(d.source_urls) ? d.source_urls[0] ?? null : null,
      detail: d.status_label ? `Statut : ${d.status_label}` : null,
    });
  }
  return ev;
}

// Score de pertinence : recouvrement de termes pondéré par leur rareté (façon IDF).
// Un mot rare partagé (« narcotrafic ») vaut bien plus qu'un mot courant (« emploi »).
export function buildScorer(corpus: Ev[]) {
  const df = new Map<string, number>();
  const corpusTerms = corpus.map(e => {
    const t = new Set(terms(e.title));
    for (const w of t) df.set(w, (df.get(w) || 0) + 1);
    return t;
  });
  const N = corpus.length;
  const idf = (w: string) => Math.log(N / (1 + (df.get(w) || 0)));

  return (engagement: string): Array<{ ev: Ev; score: number }> => {
    const q = [...new Set(terms(engagement))];
    if (q.length === 0) return [];
    const scored: Array<{ ev: Ev; score: number }> = [];
    for (let i = 0; i < corpus.length; i++) {
      let score = 0, hits = 0;
      for (const w of q) if (corpusTerms[i].has(w)) { score += idf(w); hits++; }
      // Au moins 2 termes significatifs en commun : évite les rapprochements fortuits.
      if (hits >= 2) scored.push({ ev: corpus[i], score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, TOP_EVIDENCE);
  };
}

// ---------------------------------------------------------------------------
// Couche web : Wikipédia FR (API libre, sans clé, sans mur anti-bot).
//
// Indispensable, car une grande partie des engagements ne passe PAS par une loi
// (tiers-lieux, accès à l'école, pass Culture…) : la base de l'Assemblée est alors
// structurellement muette. C'est aussi cette couche qui rattrape les faits récents
// que le modèle ignore — ex. la réduction du pass Culture en 2025, qu'il présentait
// à tort comme un engagement « tenu ».
const WIKI = "https://fr.wikipedia.org/w/api.php";

async function wikiJson(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ format: "json", ...params }).toString();
  const res = await fetch(`${WIKI}?${qs}`, { headers: { "User-Agent": "LaPolitiqueBot/1.0" }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  return res.json();
}

// Extrait les passages d'un article qui parlent réellement de l'engagement, plutôt que
// de balancer 12 000 caractères d'article au modèle.
// Signaux d'évolution récente. Sans eux, on remontait la définition générique du
// dispositif (« le pass Culture est un dispositif d'accès… ») au lieu de sa réduction
// de 2025 — soit exactement le fait qui change le verdict. Une promesse appliquée puis
// démantelée n'est pas tenue : encore faut-il donner l'information au modèle.
const CHANGE = /\b(r[ée]duit|r[ée]duction|supprim|suppression|gel[ée]?|report|abandon|abrog|divis[ée]|baisse|restrein|recul|renonc|diminu|revu|r[ée]forme|modif)/i;
const RECENT = /\b(202[3-9])\b/;

function relevantPassages(text: string, q: string[], max = 4): string[] {
  const out: Array<{ s: string; score: number }> = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (sentence.length < 40 || sentence.length > 400) continue;
    const st = new Set(terms(sentence));
    const hits = q.filter(w => st.has(w)).length;
    if (hits < 2) continue;
    let score = hits;
    if (RECENT.test(sentence)) score += 3;   // l'actualité prime sur la définition
    if (CHANGE.test(sentence)) score += 3;   // un retour en arrière est décisif
    out.push({ s: sentence.trim(), score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max).map(o => o.s);
}

// Le sac de mots-clés donnait des résultats absurdes : pour « extension du pass Culture »,
// Wikipédia renvoyait « Liste des présidents des États-Unis ». On demande donc au modèle le
// SUJET de l'engagement (le nom de la chose, pas la phrase), ce que le moteur sait chercher.
async function wikiQuery(engagement: string): Promise<string | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-chat",
    max_tokens: 1200,
    system: `On te donne un engagement politique. Réponds UNIQUEMENT par le titre d'article Wikipédia français le plus susceptible d'en traiter — 1 à 4 mots, le nom du dispositif, de la réforme ou de l'institution concernée. Pas de phrase, pas d'explication. Si aucun sujet identifiable, réponds : AUCUN`,
    messages: [{ role: "user", content: engagement }],
  }, { timeoutMs: 60000 }).catch(() => null);
  const t = (resp?.content?.[0]?.text ?? "").trim().split("\n")[0].replace(/^["'«»\s]+|["'«»\s.]+$/g, "");
  if (!t || /^aucun$/i.test(t) || t.length > 60) return null;
  return t;
}

export async function wikiEvidence(engagement: string): Promise<Ev[]> {
  const q = [...new Set(terms(engagement))];
  if (q.length < 2) return [];
  const query = await wikiQuery(engagement);
  if (!query) return [];
  try {
    const search = await wikiJson({ action: "query", list: "search", srsearch: query, srlimit: "2" });
    const hits = search?.query?.search ?? [];
    const out: Ev[] = [];
    for (const h of hits) {
      const page = await wikiJson({ action: "query", prop: "extracts", explaintext: "1", titles: h.title });
      const pages = page?.query?.pages ?? {};
      const extract: string = (Object.values(pages)[0] as any)?.extract ?? "";
      if (!extract) continue;
      const passages = relevantPassages(extract, q);
      if (passages.length === 0) continue;
      out.push({
        type: "wikipedia",
        title: `Wikipédia — ${h.title}`,
        date: null,
        url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`,
        detail: passages.join(" […] ").slice(0, 900),
      });
      await sleep(120);
    }
    return out;
  } catch { return []; }
}

