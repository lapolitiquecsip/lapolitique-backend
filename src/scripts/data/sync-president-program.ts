import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Programme présidentiel 2022 d'Emmanuel Macron + état d'avancement.
//
// Deux natures de données, volontairement séparées :
//   1. LES ENGAGEMENTS = faits. Extraits du programme officiel « Avec Vous » (PDF 24 pages,
//      archivé). Le modèle ne fait que les RECOPIER depuis le texte fourni — il lui est
//      interdit d'en inventer. C'est la garantie contre un programme fabriqué.
//   2. LE STATUT = appréciation générée par IA. Stocké avec ai_generated = true et affiché
//      comme tel sur le site. Ce n'est pas un fait vérifié.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROGRAM_FILE = path.join(__dirname, "../../data/programme-macron-2022.txt");
const SOURCE_URL = "https://web.archive.org/web/20220317215226if_/https://avecvous.fr/wp-content/uploads/2022/03/Emmanuel-Macron-Avec-Vous-24-pages.pdf";
const YEAR = 2022;

const hash = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 32);
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

type Engagement = { pacte: string; theme: string; engagement: string };

// Tolère une réponse tronquée par la limite de tokens : on récupère les objets complets
// plutôt que de tout perdre parce qu'il manque le « ] » final.
function extractJson(raw: string): any[] {
  const t = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("[");
  if (start === -1) throw new Error("Pas de JSON dans la réponse");
  const end = t.lastIndexOf("]");
  if (end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch { /* on tente le sauvetage */ }
  }
  const objects: any[] = [];
  for (const m of t.slice(start).matchAll(/\{[^{}]*\}/g)) {
    try { objects.push(JSON.parse(m[0])); } catch { /* objet incomplet : ignoré */ }
  }
  if (objects.length === 0) throw new Error("Pas de JSON exploitable dans la réponse");
  return objects;
}

// Découpe le programme en tranches qui se chevauchent légèrement, pour ne pas couper
// un engagement en deux à la frontière.
function chunk(text: string, size: number, overlap: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    out.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return out;
}

// Étape 1 — extraction des engagements DEPUIS le texte officiel (aucune invention permise).
// Traité par tranches : le programme entier d'un coup dépassait la limite de sortie du
// modèle et la réponse arrivait tronquée.
async function extractEngagements(programText: string): Promise<Engagement[]> {
  const parts = chunk(programText, 5000, 400);
  console.log(`> Programme découpé en ${parts.length} tranches.`);
  const out: Engagement[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < parts.length; i++) {
    const resp = await resilientDeepSeek.createMessage({
      model: "deepseek-v4-flash",
      // deepseek-v4-flash raisonne avant de répondre : son raisonnement consomme le budget
      // de tokens. Trop bas, il épuise max_tokens et renvoie un contenu VIDE. Il faut donc
      // prévoir large = raisonnement + réponse.
      max_tokens: 8000,
      system: `Tu reçois un EXTRAIT du programme présidentiel officiel d'Emmanuel Macron (2022).

Ta tâche : en extraire les ENGAGEMENTS CONCRETS et vérifiables présents dans CET extrait.

RÈGLES ABSOLUES :
- N'invente RIEN. Chaque engagement doit figurer dans l'extrait fourni.
- Reprends la formulation du texte, en une phrase courte et lisible.
- Ignore le récit, le bilan, la lettre aux Français, les slogans, le sommaire.
- Ne garde que des engagements d'action (ce qui sera fait), pas des constats.
- "pacte" = la grande partie du programme (telle qu'écrite dans le texte), sinon "".
- "theme" = le chapitre (ex. "Pour notre santé"), sinon "".
- Si l'extrait ne contient aucun engagement, réponds exactement : []

Réponds UNIQUEMENT par un tableau JSON compact, sans texte autour :
[{"pacte":"...","theme":"...","engagement":"..."}]`,
      messages: [{ role: "user", content: parts[i] }],
    }, { timeoutMs: 180000 });

    let text = resp.content?.[0]?.text ?? "";

    // Le modèle renvoie parfois un contenu vide (son raisonnement a mangé le budget) :
    // sans reprise, la tranche est perdue et des engagements manquent au programme.
    if (!text.trim()) {
      console.warn(`  ~ tranche ${i + 1} : réponse vide, nouvelle tentative avec un budget élargi…`);
      const retry = await resilientDeepSeek.createMessage({
        model: "deepseek-v4-flash",
        max_tokens: 16000,
        system: `Extrais les engagements concrets présents dans cet extrait du programme présidentiel 2022 d'Emmanuel Macron. N'invente rien : chaque engagement doit figurer dans l'extrait. Réponds UNIQUEMENT par un tableau JSON [{"pacte":"","theme":"","engagement":""}] (tableau vide s'il n'y en a aucun).`,
        messages: [{ role: "user", content: parts[i] }],
      }, { timeoutMs: 240000 }).catch(() => null);
      text = retry?.content?.[0]?.text ?? "";
    }

    let arr: any[] = [];
    if (!text.trim()) { console.warn(`  ! tranche ${i + 1} : toujours vide après reprise, ignorée.`); continue; }
    try { arr = extractJson(text); }
    catch { console.warn(`  ! tranche ${i + 1} : JSON inexploitable, ignorée.`); continue; }

    let added = 0;
    for (const e of arr) {
      const engagement = String(e?.engagement ?? "").trim();
      if (engagement.length < 15) continue;
      const k = norm(engagement);
      if (seen.has(k)) continue;        // dédoublonne les chevauchements entre tranches
      seen.add(k);
      out.push({ pacte: String(e?.pacte ?? "").trim(), theme: String(e?.theme ?? "").trim(), engagement });
      added++;
    }
    console.log(`  tranche ${i + 1}/${parts.length} : +${added} engagement(s)`);
  }
  return out;
}

// Étape 2 — évaluation de l'avancement (IA). Le prompt impose la prudence : en cas de
// doute ou de connaissance insuffisante, le modèle doit répondre "non_evaluable" plutôt
// que de trancher au hasard.
async function assess(e: Engagement): Promise<{ status: string; justification: string } | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    // Idem : le raisonnement doit tenir en plus du JSON, sinon la réponse revient vide.
    max_tokens: 2500,
    system: `Tu évalues l'avancement d'un engagement du programme présidentiel 2022 d'Emmanuel Macron, au regard de ce qui a réellement été fait depuis (lois, décrets, budgets, réformes).

Statuts autorisés :
- "tenu"          : réalisé, de façon vérifiable.
- "en_cours"      : engagé (loi votée/en discussion, dispositif lancé) mais pas achevé.
- "partiel"       : partiellement réalisé, ou réalisé en deçà de l'engagement.
- "abandonne"     : renoncé, enterré ou explicitement retiré.
- "non_evaluable" : tu n'as pas de connaissance fiable, ou l'engagement est trop vague.

RÈGLE IMPORTANTE : dans le doute, réponds "non_evaluable". Ne devine jamais. Mieux vaut
admettre l'incertitude qu'affirmer un statut faux.

Justification : 1 à 2 phrases factuelles, neutres, citant si possible la mesure concrète
(nom de la loi, année). Aucun jugement politique.

Réponds UNIQUEMENT en JSON : {"status":"...","justification":"..."}`,
    messages: [{ role: "user", content: `ENGAGEMENT (2022) : ${e.engagement}\nTHÈME : ${e.theme}` }],
  }, { timeoutMs: 120000 });

  const raw = (resp.content?.[0]?.text ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = raw.indexOf("{"); const en = raw.lastIndexOf("}");
  if (s === -1 || en === -1) return null;
  try {
    const o = JSON.parse(raw.slice(s, en + 1));
    const allowed = ["tenu", "en_cours", "partiel", "abandonne", "non_evaluable"];
    const status = String(o.status ?? "").trim();
    if (!allowed.includes(status)) return null;
    const justification = String(o.justification ?? "").trim();
    return { status, justification };
  } catch { return null; }
}

async function main() {
  console.log("--- PROGRAMME PRÉSIDENTIEL 2022 : engagements + avancement ---");
  const programText = fs.readFileSync(PROGRAM_FILE, "utf-8");
  console.log(`> Programme officiel : ${programText.length} caractères.`);

  const engagements = await extractEngagements(programText);
  console.log(`> ${engagements.length} engagements extraits du texte officiel.`);
  if (engagements.length === 0) throw new Error("Aucun engagement extrait — on n'écrit rien.");

  const rows: any[] = [];
  let assessed = 0;
  for (const e of engagements) {
    const a = await assess(e).catch(() => null);
    if (a) assessed++;
    rows.push({
      id: hash(norm(e.engagement)),
      year: YEAR,
      pacte: e.pacte || null,
      theme: e.theme || null,
      engagement: e.engagement,
      source_url: SOURCE_URL,
      status: a?.status ?? "non_evaluable",
      justification: a?.justification ?? null,
      ai_generated: true,
      assessed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await new Promise(r => setTimeout(r, 150));
  }
  console.log(`> ${assessed}/${rows.length} engagements évalués.`);
  const counts = rows.reduce((a: Record<string, number>, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  console.log("> Répartition des statuts :", counts);

  // Rafraîchissement complet : une extraction peut faire varier la formulation (donc le
  // hash). Sans purge, les engagements d'un run précédent resteraient affichés en double.
  const keep = rows.map(r => r.id);
  const { error: delErr } = await supabase
    .from("presidential_program").delete().eq("year", YEAR).not("id", "in", `(${keep.map(k => `"${k}"`).join(",")})`);
  if (delErr) console.warn("[Program] purge:", delErr.message);

  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from("presidential_program").upsert(rows.slice(i, i + 100), { onConflict: "id" });
    if (error) { console.error("[Program] upsert:", error.message); throw error; }
  }
  console.log(`--- TERMINE. ${rows.length} engagements. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
