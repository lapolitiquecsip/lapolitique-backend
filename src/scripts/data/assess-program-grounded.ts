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
const MANDATE_START = "2022-05-14";   // début du second quinquennat
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

RÈGLE FONDAMENTALE : tu ne dois te fonder QUE sur les FAITS fournis ci-dessous (scrutins de
l'Assemblée nationale et dossiers législatifs réels, postérieurs à mai 2022). N'utilise PAS
tes souvenirs : ta connaissance est incomplète et périmée. Si les faits fournis ne permettent
pas de conclure, réponds "non_evaluable". C'est une réponse parfaitement acceptable et
préférable à une affirmation non étayée.

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
    system: `Tu évalues l'avancement d'un engagement du programme présidentiel 2022 d'Emmanuel Macron.

Aucun fait ne t'est fourni : appuie-toi sur ta connaissance (lois, décrets, réformes depuis 2022).

Statuts : "tenu", "en_cours", "partiel", "abandonne", "non_evaluable".
RÈGLE : dans le doute, réponds "non_evaluable". Ne devine jamais.
Justification : 1 à 2 phrases factuelles citant la mesure (nom de la loi, année). Neutre.

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
    const candidates = findEvidence(e.engagement).map(c => c.ev);
    let res = await assessWithEvidence(e.engagement, e.theme, candidates).catch(() => null);
    let evidence = res?.evidence ?? [];

    // Aucune preuve exploitable en base → repli sur la connaissance du modèle, signalé.
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
