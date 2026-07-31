import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Évaluation ANCRÉE de l'avancement du programme présidentiel 2022.
//
// Pourquoi ce script existe : la première version demandait au modèle de juger de mémoire.
// Or sa connaissance s'arrête vers 2024 — les statuts « en cours » étaient donc invérifiables
// et potentiellement périmés. Ici, on lui interdit de s'appuyer sur sa mémoire : il ne peut
// trancher qu'à partir de FAITS tirés de nos tables (scrutins de l'AN, dossiers législatifs),
// tous datés et sourcés. Sans preuve, le verdict est "non_evaluable".
const TAVILY_KEY = process.env.TAVILY_API_KEY || "";   // recherche web plein-texte (optionnelle)
const MANDATE_START = "2022-05-14";   // début du second quinquennat

// Couche web GÉNÉRALISTE (Tavily) : de vraies preuves plein-web par engagement, au-delà de
// Wikipédia. Activée seulement si TAVILY_API_KEY est présent ; sinon le pipeline reste inchangé.
async function tavilyEvidence(engagement: string): Promise<{ type: string; title: string; date: string | null; url: string | null; detail?: string | null }[]> {
  if (!TAVILY_KEY) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${TAVILY_KEY}`, "Content-Type": "application/json" },
      // Tavily ne gère pas bien les accents : on dé-accentue la requête (sinon 0 résultat).
      body: JSON.stringify({
        query: `Macron programme 2022 ${(engagement || "").normalize("NFD").replace(/[̀-ͯ]/g, "").slice(0, 150)} application loi reforme bilan 2022 2026`,
        max_results: 5, search_depth: "advanced", include_answer: false,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return [];
    const d: any = await res.json();
    return (d.results || []).filter((r: any) => r.content).slice(0, 5).map((r: any) => ({
      type: "web", title: `Web — ${r.title || r.url}`, date: r.published_date || null, url: r.url,
      detail: String(r.content).replace(/\s+/g, " ").slice(0, 900),
    }));
  } catch { return []; }
}
const TOP_EVIDENCE = 8;               // preuves soumises au modèle par engagement

// Seuls les scrutins qui tranchent réellement le sort d'un texte. Les votes d'amendements
// et d'articles (l'écrasante majorité) sont du bruit procédural pour notre usage.
const DECISIVE = /^\s*(l'ensemble|la motion|la déclaration|la declaration|la première partie|la premiere partie|la seconde partie|la proposition de résolution|la proposition de resolution)/i;

type Ev = { type: string; title: string; date: string | null; url: string | null; detail?: string | null };

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
async function loadEvidence(): Promise<Ev[]> {
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
function buildScorer(corpus: Ev[]) {
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
function relevantPassages(text: string, q: string[], max = 3): string[] {
  const out: Array<{ s: string; score: number }> = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (sentence.length < 40 || sentence.length > 400) continue;
    const st = new Set(terms(sentence));
    const hits = q.filter(w => st.has(w)).length;
    if (hits >= 2) out.push({ s: sentence.trim(), score: hits });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max).map(o => o.s);
}

// Le sac de mots-clés donnait des résultats absurdes : pour « extension du pass Culture »,
// Wikipédia renvoyait « Liste des présidents des États-Unis ». On demande donc au modèle le
// SUJET de l'engagement (le nom de la chose, pas la phrase), ce que le moteur sait chercher.
async function wikiQuery(engagement: string): Promise<string | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 1200,
    system: `On te donne un engagement politique. Réponds UNIQUEMENT par le titre d'article Wikipédia français le plus susceptible d'en traiter — 1 à 4 mots, le nom du dispositif, de la réforme ou de l'institution concernée. Pas de phrase, pas d'explication. Si aucun sujet identifiable, réponds : AUCUN`,
    messages: [{ role: "user", content: engagement }],
  }, { timeoutMs: 60000 }).catch(() => null);
  const t = (resp?.content?.[0]?.text ?? "").trim().split("\n")[0].replace(/^["'«»\s]+|["'«»\s.]+$/g, "");
  if (!t || /^aucun$/i.test(t) || t.length > 60) return null;
  return t;
}

async function wikiEvidence(engagement: string): Promise<Ev[]> {
  const q = [...new Set(terms(engagement))];
  if (q.length < 2) return [];
  const query = await wikiQuery(engagement);
  if (!query) return [];
  try {
    const search = await wikiJson({ action: "query", list: "search", srsearch: query, srlimit: "4" });
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

async function assessWithEvidence(engagement: string, theme: string | null, ev: Ev[]) {
  const list = ev.map((e, i) =>
    `${i + 1}. [${e.type}] ${e.title}${e.date ? ` (${e.date})` : ""}${e.detail ? ` — ${e.detail}` : ""}`
  ).join("\n");

  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    // Modèle à raisonnement : le budget doit couvrir sa réflexion PUIS sa réponse,
    // sinon il renvoie un contenu vide sans erreur.
    max_tokens: 3000,
    system: `Tu évalues l'avancement d'un engagement du programme présidentiel 2022 d'Emmanuel Macron.

RÈGLE FONDAMENTALE : tu ne dois te fonder QUE sur les FAITS fournis ci-dessous. N'utilise PAS
tes souvenirs : ta connaissance est incomplète et périmée (elle ignore 2025-2026).

Les faits sont de deux natures, à ne pas confondre :
- [scrutin] / [dossier] : actes parlementaires officiels. Preuve forte.
- [wikipedia] : synthèse encyclopédique, utile notamment pour les mesures qui ne passent pas
  par une loi et pour les évolutions récentes. Preuve indicative, à manier avec prudence.
- [web] : article de presse ou source en ligne (recherche web). Preuve indicative et récente,
  utile pour l'application concrète et les reculs ; à recouper, ne jamais surinterpréter.

ATTENTION AUX RETOURS EN ARRIÈRE : un engagement appliqué puis réduit, gelé ou supprimé
n'est PAS "tenu". Regarde toujours le fait le PLUS RÉCENT. Un fait antérieur à 2022 ne peut
jamais prouver qu'une promesse de 2022 a été tenue.

Si les faits ne permettent pas de conclure, réponds "non_evaluable" : c'est préférable à une
affirmation non étayée.

Statuts autorisés :
- "tenu"          : les faits montrent que l'engagement est réalisé (texte adopté/promulgué).
- "en_cours"      : les faits montrent une démarche engagée mais pas achevée.
- "partiel"       : les faits montrent une réalisation partielle ou en deçà de l'engagement.
- "abandonne"     : les faits montrent un rejet ou un retrait.
- "non_evaluable" : les faits fournis ne concernent pas l'engagement, ou sont insuffisants.

"evidence_used" : les NUMÉROS des faits que tu as réellement utilisés (tableau, vide si aucun).
"justification" : 1 à 2 phrases factuelles citant le fait utilisé (intitulé, date). Neutre.

Réponds UNIQUEMENT en JSON :
{"status":"...","justification":"...","evidence_used":[1,2]}`,
    messages: [{
      role: "user",
      content: `ENGAGEMENT (programme 2022) : ${engagement}\nTHÈME : ${theme || "—"}\n\nFAITS DISPONIBLES :\n${list || "(aucun fait pertinent trouvé)"}`,
    }],
  }, { timeoutMs: 120000 });

  const raw = (resp.content?.[0]?.text ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a === -1 || b === -1) return null;
  try {
    const o = JSON.parse(raw.slice(a, b + 1));
    const allowed = ["tenu", "en_cours", "partiel", "abandonne", "non_evaluable"];
    if (!allowed.includes(o.status)) return null;
    const used: number[] = Array.isArray(o.evidence_used) ? o.evidence_used : [];
    return {
      status: o.status as string,
      justification: String(o.justification ?? "").trim(),
      // On ne conserve que les preuves effectivement invoquées par le modèle.
      evidence: used.map((n: number) => ev[n - 1]).filter(Boolean),
    };
  } catch { return null; }
}

// Repli documenté : nos tables ne commencent qu'en octobre 2024 (scrutins) et ne couvrent
// que la législature 17. Or le programme 2022 s'est appliqué pour l'essentiel AVANT — la
// preuve n'existe donc pas en base pour la majorité des engagements. Plutôt que d'afficher
// 126 « non évaluable » sur 141, on retombe sur la connaissance du modèle, mais l'évaluation
// est alors marquée comme NON ÉTAYÉE (evidence_count = 0) et le front la distingue.
async function assessFromKnowledge(engagement: string, theme: string | null) {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 2500,
    system: `Tu évalues l'avancement d'un engagement du programme présidentiel 2022 d'Emmanuel Macron, à partir de ta CONNAISSANCE des faits publics du quinquennat 2022-2027 (lois votées, décrets, réformes, budgets, décisions, reculs).

Évalue AU MIEUX à partir de ce que tu sais réellement s'être passé depuis 2022 :
- "tenu"        : mesure réalisée (loi/décret adopté, dispositif effectivement en place).
- "en_cours"    : démarche engagée mais pas achevée (projet déposé, réforme lancée, concertation).
- "partiel"     : réalisé en deçà de l'engagement, ou appliqué puis réduit/gelé.
- "abandonne"   : promesse rejetée, retirée ou explicitement abandonnée.
- "non_evaluable" : UNIQUEMENT si l'engagement est trop vague pour être vérifiable, ou si tu n'as réellement AUCUNE information sur son sort.

N'ABUSE PAS de "non_evaluable" : la quasi-totalité des engagements de 2022 a connu une suite documentée (retraites à 64 ans, France Travail, réforme de l'assurance chômage, lois immigration, plein emploi, énergie/nucléaire, école…). Fonde-toi sur le fait le PLUS RÉCENT (un dispositif réduit ou gelé n'est pas "tenu").

Justification : 1 à 2 phrases factuelles citant la mesure (nom de la loi/réforme + année). Neutre, sans jugement.

Réponds UNIQUEMENT en JSON : {"status":"...","justification":"..."}`,
    messages: [{ role: "user", content: `ENGAGEMENT (2022) : ${engagement}\nTHÈME : ${theme || "—"}` }],
  }, { timeoutMs: 120000 });

  const raw = (resp.content?.[0]?.text ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a === -1 || b === -1) return null;
  try {
    const o = JSON.parse(raw.slice(a, b + 1));
    const allowed = ["tenu", "en_cours", "partiel", "abandonne", "non_evaluable"];
    if (!allowed.includes(o.status)) return null;
    return { status: o.status as string, justification: String(o.justification ?? "").trim() };
  } catch { return null; }
}

async function main() {
  console.log("--- ÉVALUATION ANCRÉE DU PROGRAMME (scrutins + dossiers réels) ---");

  const { data: engagements, error } = await supabase
    .from("presidential_program").select("id,engagement,theme").eq("year", 2022);
  if (error) throw error;
  if (!engagements?.length) throw new Error("Aucun engagement en base — lancer d'abord sync-president-program.");
  console.log(`> ${engagements.length} engagements à évaluer.`);

  const corpus = await loadEvidence();
  console.log(`> Corpus de preuves : ${corpus.length} faits depuis le ${MANDATE_START}.`);
  const findEvidence = buildScorer(corpus);

  let done = 0, withEv = 0, fallback = 0;
  const counts: Record<string, number> = {};
  for (const e of engagements as any[]) {
    // Preuves officielles (scrutins/dossiers) + couche web (Wikipédia). Beaucoup
    // d'engagements ne passent pas par une loi : sans le web, ils resteraient à jamais
    // « non vérifié ».
    const legal = findEvidence(e.engagement).map(c => c.ev);
    const [web, webT] = await Promise.all([wikiEvidence(e.engagement), tavilyEvidence(e.engagement)]);
    const candidates = [...legal, ...web, ...webT];
    let res = await assessWithEvidence(e.engagement, e.theme, candidates).catch(() => null);
    let evidence = res?.evidence ?? [];

    if (evidence.length === 0) {
      const k = await assessFromKnowledge(e.engagement, e.theme).catch(() => null);
      if (k) { res = { ...k, evidence: [] }; fallback++; }
    } else {
      withEv++;
    }

    const status = res?.status ?? "non_evaluable";
    counts[status] = (counts[status] || 0) + 1;

    const { error: upErr } = await supabase.from("presidential_program").update({
      status,
      justification: res?.justification ?? null,
      evidence,
      evidence_count: evidence.length,
      assessed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", e.id);
    if (upErr) console.warn("  ! update:", upErr.message);

    done++;
    if (done % 20 === 0) console.log(`  ${done}/${engagements.length}…`);
    await new Promise(r => setTimeout(r, 120));
  }

  console.log(`> Évalués : ${done}`);
  console.log(`>   dont étayés par des faits en base : ${withEv}`);
  console.log(`>   dont évalués de mémoire (aucune preuve en base) : ${fallback}`);
  console.log("> Répartition :", counts);
  console.log("--- TERMINE ---");
}

main().catch(e => { console.error(e); process.exit(1); });
