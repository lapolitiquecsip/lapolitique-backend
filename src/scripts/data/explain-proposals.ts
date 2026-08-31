import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { matchDomains } from "../../lib/interest-domains.js";

// Explication pédagogique de chaque proposition d'un candidat (le « ? » de la fiche) :
// définit le jargon (C3S, CVAE…), explique le POURQUOI, et met en contexte avec des CHIFFRES
// NATIONAUX VÉRIFIÉS (INSEE/officiels). deepseek-chat, GROUNDED : interdiction absolue d'inventer
// un chiffre — on ne fournit à l'IA que des chiffres vérifiés + ceux déjà dans la proposition.
// Idempotent : ne (re)génère que les propositions sans `explanation`.

const BATCH = Number(process.env.EXPLAIN_BATCH || 60);

// Chiffres NATIONAUX VÉRIFIÉS (sources officielles), par domaine — servent de contexte à l'IA.
// Alignés sur les données curées du site (campaignThemes/publicFinance). À réviser si les sources
// publient de nouveaux chiffres.
const NATIONAL_FIGURES: Record<string, string[]> = {
  economie: [
    "Déficit public : 5,1 % du PIB en 2025 (INSEE).",
    "Dette publique : 115,6 % du PIB fin 2025 (INSEE).",
    "Prélèvements obligatoires : environ 43 % du PIB (parmi les plus élevés de l'UE).",
    "Les impôts de production français sont parmi les plus élevés de l'Union européenne.",
  ],
  emploi: [
    "Taux de chômage : 7,9 % fin 2025, au sens du BIT (INSEE).",
  ],
  retraites: [
    "Âge légal de départ à la retraite : 64 ans (réforme de 2023, montée en charge jusqu'en 2030).",
    "27,7 % de la population a 60 ans ou plus (1ᵉʳ janvier 2024, INSEE).",
  ],
  immigration: [
    "8,0 millions d'immigrés vivent en France, soit 11,6 % de la population (2025, INSEE).",
    "Solde migratoire : +152 000 en 2024 (INSEE).",
    "Demandes d'asile : environ 140 000 par an (guichet unique, ministère de l'Intérieur).",
  ],
  ecologie: [
    "Intensité carbone de l'électricité : 21,7 gCO₂/kWh en 2024, le plus bas de l'histoire (RTE).",
    "Émissions du secteur électrique : −30 % en un an en 2024 (RTE).",
  ],
  securite: [
    "Homicides : 976 victimes en 2024, en baisse de 2 % (SSMSI, ministère de l'Intérieur).",
    "Violences sexuelles enregistrées : +9 % en 2024 (SSMSI).",
  ],
  education: [
    "Score PISA en mathématiques : 474 points en 2022 (OCDE), en recul de 21 points depuis 2018.",
    "Dépense intérieure d'éducation : 197,1 Md€, soit 6,8 % du PIB (2024, ministère de l'Éducation nationale).",
  ],
  sante: [
    "La dépense courante de santé représente environ 12 % du PIB (parmi les plus élevées de l'OCDE).",
  ],
  agriculture: [
    "L'agriculture emploie environ 400 000 exploitants ; la France est le 1ᵉʳ producteur agricole de l'UE.",
  ],
};

const SYS = `Tu expliques UNE proposition d'un·e candidat·e à l'élection présidentielle française, à un citoyen NON expert. On te fournit la proposition et des CHIFFRES NATIONAUX VÉRIFIÉS (sources officielles).

Ta réponse (TEXTE simple, 3 à 5 phrases, neutre et factuelle) doit :
1. DÉFINIR simplement le jargon ou les sigles présents dans la proposition (ex. « la C3S est une contribution des entreprises assise sur leur chiffre d'affaires »).
2. Expliquer POURQUOI le·la candidat·e propose cela (l'objectif visé), sans jugement de valeur.
3. METTRE EN CONTEXTE avec 1 ou 2 des chiffres nationaux FOURNIS (en citant la source entre parenthèses), quand c'est pertinent.

RÈGLES ABSOLUES :
- N'invente AUCUN chiffre. N'utilise QUE les chiffres FOURNIS (vérifiés) ou ceux déjà présents dans la proposition. Si tu n'as pas de chiffre fiable, n'en mets pas.
- Reste NEUTRE : tu expliques, tu ne juges pas, tu ne prends pas parti (ni pour ni contre).
- Pas de titre, pas de liste : un court paragraphe clair.`;

async function explainOne(text: string, theme: string | null): Promise<string | null> {
  const domains = matchDomains(`${theme || ""} ${text}`);
  const figures = [...new Set(domains.flatMap(d => NATIONAL_FIGURES[d] || []))].slice(0, 5);
  const figuresBlock = figures.length ? figures.map(f => `- ${f}`).join("\n") : "(aucun chiffre national fourni pour ce thème — n'en invente pas)";
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-chat", max_tokens: 500, system: SYS,
    messages: [{ role: "user", content: `PROPOSITION : ${text}\n\nCHIFFRES NATIONAUX VÉRIFIÉS (à utiliser uniquement ceux-ci) :\n${figuresBlock}` }],
  }, { timeoutMs: 60000 });
  const t = resp.content[0]?.text?.trim();
  return t && t.length > 30 ? t : null;
}

export async function explainProposals() {
  console.log("--- EXPLICATIONS DES PROPOSITIONS (le « ? ») ---");
  let rows: any[];
  try {
    // NB : subsection est NULL pour la plupart des propositions ; `.neq` exclurait ces NULL (sémantique SQL).
    // On exclut donc explicitement les seules lignes de contexte via `.or(… is.null, … neq)`.
    const { data, error } = await supabase.from("candidate_proposals")
      .select("id, text, theme, explanation")
      .or("subsection.is.null,subsection.neq.__contexte__")
      .is("explanation", null).limit(BATCH);
    if (error) {
      if (/explanation|column .* does not exist/i.test(error.message)) {
        console.log("  ! colonne candidate_proposals.explanation absente — appliquer la migration. Étape ignorée.");
        return 0;
      }
      throw error;
    }
    rows = data || [];
  } catch (e: any) { throw e; }

  console.log(`> ${rows.length} proposition(s) à expliquer (lot ${BATCH}).`);
  let done = 0;
  for (const r of rows) {
    try {
      const ex = await explainOne(r.text, r.theme);
      if (!ex) continue;
      const { error } = await supabase.from("candidate_proposals").update({ explanation: ex }).eq("id", r.id);
      if (error) { console.error(`  ! update ${r.id}: ${error.message}`); continue; }
      done++;
    } catch (e: any) { console.warn(`  ! ${r.id}: ${e.message}`); }
  }
  console.log(`--- TERMINE. ${done} explication(s) générée(s). ---`);
  return done;
}

if (process.argv[1] && process.argv[1].endsWith("explain-proposals.ts")) {
  explainProposals().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
