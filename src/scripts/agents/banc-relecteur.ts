import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { FAMILLES, lireSource, extraitPertinent, type Famille } from "../../lib/banc.js";

/**
 * BANC D'ESSAI — agent « relecteur » (un AUTRE modèle que celui qui a écrit).
 *
 * Les textes du site sont rédigés par Gemini. Le relecteur est un modèle d'une autre maison
 * (gpt-oss d'OpenAI, servi par Groq) : il reçoit la source et le texte publié, et dit si le
 * texte est fidèle, neutre et clair. Faire relire un texte par le modèle qui l'a écrit ne
 * prouve rien — il retombe sur les mêmes erreurs ; un second regard n'a de valeur que s'il
 * vient d'ailleurs.
 *
 * Il ne modifie aucun contenu : son avis est rangé à côté de celui du vérificateur, dans le
 * journal. En fin d'essai, on compare : là où les deux agents signalent le même texte, une
 * chaîne à plusieurs agents aurait évité une erreur.
 *
 * Contenu envoyé : uniquement des textes publics (comptes rendus, articles, communiqués) et
 * leur résumé déjà publié. Aucune donnée d'abonné.
 *
 * Usage : npx tsx src/scripts/agents/banc-relecteur.ts [--max=3] [--famille=commissions]
 */
const AGENT = "banc-relecteur";
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split("=")[1];
const MAX = Number(arg("max") || 3);
const SEULE = arg("famille");
const CLE = process.env.GROQ_API_KEY || process.env.ASR_API_KEY || "";
const MODELE = process.env.RELECTEUR_MODEL || "openai/gpt-oss-120b";
/**
 * Le palier gratuit accorde 8 000 jetons par minute et 1 000 demandes par jour : la source
 * est bornée à ce qui tient dans une demande, et l'on en fait une par minute.
 */
const SOURCE_MAX = Number(process.env.RELECTEUR_SOURCE_MAX || 10800);
const PAUSE_MS = 62000;

const CONSIGNE = `Tu es relecteur pour un site français d'information politique, neutre et pédagogique.
On te donne une SOURCE (document officiel ou article) et le TEXTE PUBLIÉ que le site en a tiré.
Ton seul travail est de comparer le texte publié à la source. Tu ne réécris rien.

Réponds en JSON strict :
{
  "fidele": true | false,            // false si le texte affirme un fait, un chiffre, un nom ou une citation que la source ne contient pas ou contredit
  "erreurs": [ { "extrait": "passage du texte publié", "probleme": "ce que la source dit réellement, ou « absent de la source »" } ],
  "neutre": true | false,            // false si le texte prend parti, juge, ou présente une opinion comme un fait
  "remarque_neutralite": "… ou null",
  "clarte": 1-5,                     // 5 = limpide pour un lecteur non spécialiste
  "oubli": "fait essentiel de la source absent du texte, ou null"
}

Règles :
- Une erreur est une affirmation FAUSSE ou INVENTÉE. Une omission n'est pas une erreur : elle va dans "oubli".
- Ne sont pas des erreurs : l'année ou la date de publication ajoutée, le nom du média ou de l'institution d'où vient la source, une reformulation fidèle, un arrondi évident.
- Si la source est marquée EXTRAITS, tu n'en vois que des passages : un fait que tu n'y retrouves pas n'est PAS une erreur, sauf si un passage le contredit. Dans le doute, "fidele": true.
- Maximum 4 erreurs, les plus graves.`;

async function relire(source: string, texte: string): Promise<any | "quota"> {
  const { extrait, partiel: tronquee } = extraitPertinent(source, texte, SOURCE_MAX);
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(120000),
    headers: { Authorization: `Bearer ${CLE}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODELE, temperature: 0, response_format: { type: "json_object" }, max_completion_tokens: 2200,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: CONSIGNE },
        { role: "user", content: `SOURCE${tronquee ? " (EXTRAITS)" : ""} :\n${extrait}\n\n--- TEXTE PUBLIÉ ---\n${texte.slice(0, 4000)}` },
      ],
    }),
  });
  if (r.status === 429 || r.status === 413) return "quota";
  // Réponse que le modèle n'a pas su mettre en JSON : on passe ce texte, sans arrêter le passage.
  if (r.status === 400) return null;
  if (!r.ok) throw new Error(`relecteur : HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  const j: any = await r.json();
  return { ...JSON.parse(j.choices?.[0]?.message?.content || "{}"), modele: MODELE, source_tronquee: tronquee };
}

async function passer(f: Famille): Promise<boolean> {
  const cycle = `banc:${f.cle}`;
  // Les textes déjà vus par le vérificateur, source lisible, pas encore relus.
  const { data: items } = await supabase.from("cycle_items").select("cle, etape, donnees")
    .eq("cycle", cycle).in("etape", ["conforme", "a_revoir"]).is("donnees->relecteur", null)
    .order("maj_le", { ascending: false }).limit(MAX);
  let relus = 0;
  for (const it of items ?? []) {
    const { data: r } = await supabase.from(f.table).select(f.colonnes).eq(f.id, it.cle).maybeSingle();
    if (!r) continue;
    const lue = await lireSource(f.source(r));
    if ("motif" in lue) continue;
    try {
      const avis = await relire(lue.texte, f.texte(r));
      if (avis === "quota") { console.log("  Quota du relecteur atteint : on s'arrête là pour ce passage."); return false; }
      if (!avis) { console.log(`    (avis illisible, texte passé) — ${String(f.titre(r) ?? "").slice(0, 60)}`); await new Promise(x => setTimeout(x, PAUSE_MS)); continue; }
      await supabase.from("cycle_items").update({
        donnees: { ...it.donnees, relecteur: avis }, agent: AGENT, maj_le: new Date().toISOString(),
      }).eq("cycle", cycle).eq("cle", it.cle);
      relus++;
      const verdict = avis.fidele === false ? `INFIDÈLE (${(avis.erreurs ?? []).length} erreur(s))` : "fidèle";
      console.log(`    ${verdict}${avis.neutre === false ? " · PAS NEUTRE" : ""} · clarté ${avis.clarte ?? "?"}/5 — ${String(f.titre(r) ?? "").slice(0, 70)}`);
      for (const e of (avis.erreurs ?? []).slice(0, 2)) console.log(`        « ${String(e.extrait).slice(0, 90)} » → ${String(e.probleme).slice(0, 110)}`);
    } catch (e: any) { console.warn(`    ! ${e.message}`); }
    await new Promise(x => setTimeout(x, PAUSE_MS));
  }
  console.log(`  ${f.nom} : ${relus} texte(s) relu(s)`);
  return true;
}

async function main() {
  console.log("=== Banc d'essai · relecteur ===");
  if (!CLE) {
    console.log("::warning title=Relecteur inactif::Secret GROQ_API_KEY absent : le second modèle ne relit rien.");
    return;
  }
  for (const f of FAMILLES) {
    if (SEULE && SEULE !== f.cle) continue;
    if (!(await passer(f))) break;
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
