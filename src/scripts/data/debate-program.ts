import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Passe CONTRADICTOIRE sur le programme présidentiel 2022.
//
// Constat qui motive ce script : ~100 engagements sont structurellement indécidables.
// « Multiplier les tiers-lieux », « Accueil facilité des combattantes et combattants de la
// liberté » : aucune loi, aucun scrutin ne les tranchera jamais. Leur coller « non vérifié »
// est exact mais inutile ; leur coller un verdict est faux (cf. « pass Culture = tenu »,
// justifié par un décret de 2021 antérieur à la promesse, en ignorant sa réduction de 2025).
//
// On produit donc, pour chaque engagement : ce qui est ÉTABLI, ce qui plaide POUR, ce qui
// plaide CONTRE, et un statut assorti d'un niveau de confiance. Le lecteur peut juger.
//
// Reprend le moteur de preuves de assess-program-grounded.ts (scrutins + dossiers + Wikipédia).
import { loadEvidenceCorpus, buildScorer, wikiEvidence, type Ev } from "./program-evidence.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Debate = {
  status: string; confidence: string;
  certitudes: string; arguments_pour: string; arguments_contre: string;
  justification: string; evidence_used: number[];
};

async function debate(engagement: string, theme: string | null, ev: Ev[]): Promise<Debate | null> {
  const list = ev.map((e, i) =>
    `${i + 1}. [${e.type}] ${e.title}${e.date ? ` (${e.date})` : ""}${e.detail ? ` — ${e.detail}` : ""}`
  ).join("\n");

  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    // Modèle à raisonnement : budget = réflexion + réponse, sinon contenu vide sans erreur.
    max_tokens: 5000,
    system: `Tu instruis, à charge ET à décharge, l'avancement d'un engagement du programme
présidentiel 2022 d'Emmanuel Macron. Tu n'es pas un juge : tu exposes le dossier.

TU NE DOIS TE FONDER QUE SUR LES FAITS FOURNIS. N'utilise pas tes souvenirs : ta connaissance
ignore 2025-2026. Les faits [scrutin]/[dossier] sont des actes officiels (preuve forte) ;
les faits [wikipedia] sont indicatifs (à manier avec prudence).

RÈGLES DE PRUDENCE :
- Un fait ANTÉRIEUR à mai 2022 ne peut jamais prouver qu'une promesse de 2022 est tenue.
- Un dispositif appliqué puis réduit, gelé ou supprimé n'est PAS "tenu" : regarde le fait
  le PLUS RÉCENT.
- Beaucoup d'engagements ne passent par aucune loi : leur absence des textes ne prouve
  ni leur réalisation, ni leur abandon. Dis-le plutôt que d'inventer.

Champs à produire :
- "certitudes" : ce qui est ÉTABLI sur ce sujet au vu des faits, quel que soit le verdict.
  1 à 3 phrases. Si rien n'est établi, écris exactement : "Aucun fait probant disponible."
- "arguments_pour" : ce qui plaide pour que l'engagement soit tenu. "" si rien.
- "arguments_contre" : ce qui plaide contre. "" si rien.
- "status" : "tenu" | "en_cours" | "partiel" | "abandonne" | "non_evaluable".
  Utilise "non_evaluable" quand les faits ne permettent honnêtement pas de trancher.
- "confidence" : "haute" (actes officiels concordants) | "moyenne" (indices) | "faible".
- "justification" : 1 à 2 phrases de synthèse, neutres, citant le fait décisif s'il existe.
- "evidence_used" : numéros des faits réellement utilisés (tableau, vide si aucun).

Ton strictement factuel et neutre. Aucun jugement politique.
Réponds UNIQUEMENT en JSON :
{"status":"...","confidence":"...","certitudes":"...","arguments_pour":"...","arguments_contre":"...","justification":"...","evidence_used":[1,2]}`,
    messages: [{
      role: "user",
      content: `ENGAGEMENT (programme 2022) : ${engagement}\nTHÈME : ${theme || "—"}\n\nFAITS DISPONIBLES :\n${list || "(aucun fait pertinent trouvé)"}`,
    }],
  }, { timeoutMs: 180000 });

  const raw = (resp.content?.[0]?.text ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a === -1 || b === -1) return null;
  try {
    const o = JSON.parse(raw.slice(a, b + 1));
    const ok = ["tenu", "en_cours", "partiel", "abandonne", "non_evaluable"];
    if (!ok.includes(o.status)) return null;
    const conf = ["haute", "moyenne", "faible"].includes(o.confidence) ? o.confidence : "faible";
    return {
      status: o.status, confidence: conf,
      certitudes: String(o.certitudes ?? "").trim(),
      arguments_pour: String(o.arguments_pour ?? "").trim(),
      arguments_contre: String(o.arguments_contre ?? "").trim(),
      justification: String(o.justification ?? "").trim(),
      evidence_used: Array.isArray(o.evidence_used) ? o.evidence_used : [],
    };
  } catch { return null; }
}

async function main() {
  console.log("--- PASSE CONTRADICTOIRE DU PROGRAMME 2022 ---");
  const { data: engagements, error } = await supabase
    .from("presidential_program").select("id,engagement,theme").eq("year", 2022);
  if (error) throw error;
  console.log(`> ${engagements?.length ?? 0} engagements.`);

  const corpus = await loadEvidenceCorpus();
  console.log(`> Corpus officiel : ${corpus.length} faits.`);
  const findEvidence = buildScorer(corpus);

  let done = 0, withEv = 0, withArgs = 0;
  const counts: Record<string, number> = {};
  for (const e of engagements as any[]) {
    const legal = findEvidence(e.engagement).map(c => c.ev);
    const web = await wikiEvidence(e.engagement).catch(() => [] as Ev[]);
    const candidates = [...legal, ...web];

    const d = await debate(e.engagement, e.theme, candidates).catch(() => null);
    const evidence = (d?.evidence_used ?? []).map(n => candidates[n - 1]).filter(Boolean);
    const status = d?.status ?? "non_evaluable";
    counts[status] = (counts[status] || 0) + 1;
    if (evidence.length) withEv++;
    if (d && (d.arguments_pour || d.arguments_contre)) withArgs++;

    const { error: upErr } = await supabase.from("presidential_program").update({
      status,
      confidence: d?.confidence ?? "faible",
      certitudes: d?.certitudes || null,
      arguments_pour: d?.arguments_pour || null,
      arguments_contre: d?.arguments_contre || null,
      justification: d?.justification || null,
      evidence,
      evidence_count: evidence.length,
      verified: true,
      assessed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", e.id);
    if (upErr) console.warn("  ! update:", upErr.message);

    done++;
    if (done % 10 === 0) console.log(`  ${done}/${engagements!.length} — preuves:${withEv} arguments:${withArgs}`);
    await sleep(100);
  }

  console.log(`> Terminé : ${done} | avec preuves : ${withEv} | avec arguments pour/contre : ${withArgs}`);
  console.log("> Répartition :", counts);
  console.log("--- TERMINE ---");
}

main().catch(e => { console.error(e); process.exit(1); });
