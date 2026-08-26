import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { fetchExposeText } from "../../lib/legislative/expose.js";

// Validation à sec (aucune écriture) du nouveau pipeline de résumé enrichi par l'exposé des motifs.
// Usage : tsx src/scripts/legislative/validate-expose.ts "coût"   (sous-chaîne de titre, défaut "coût")
const needle = (process.argv[2] || "coût").toLowerCase();

const SYSTEM = `Tu rédiges une analyse éditoriale à partir des faits officiels fournis (métadonnées, étapes, amendements, scrutins et surtout "expose_des_motifs" = le texte officiel expliquant le contenu et l'objectif de la proposition/projet de loi).

PRIORITÉ AU FOND : le résumé doit d'abord dire CE QUE PRÉVOIT le texte et À QUEL PROBLÈME il répond (mesures concrètes, dispositif, objectif), en t'appuyant sur "expose_des_motifs" quand il est présent. La procédure (dépôt, renvoi en commission, dates) est SECONDAIRE : une phrase suffit, jamais le cœur du résumé.

RÈGLES : n'invente aucun auteur, statut, date, vote, montant ni mesure ; ne cite que ce qui figure dans les faits fournis. Si "expose_des_motifs" est null ou vide, dis clairement que le contenu détaillé n'est pas encore disponible, puis résume au mieux à partir du titre et des métadonnées — sans meubler avec du jargon procédural.

Réponds en JSON strict avec DEUX clés dont les valeurs sont des CHAÎNES de texte :
- public_summary : 2-3 phrases grand public, centrées sur le fond ;
- premium_summary : une seule chaîne de texte (pas un objet), en 4 sections séparées par des sauts de ligne, chaque titre en gras markdown : "**Objet et mesures**", "**Problème visé**", "**Où en est le texte**", "**Limites**".`;

async function main() {
  const { data, error } = await supabase
    .from("legislative_dossiers")
    .select("id,title,text_type,author_name,category,status_label,current_chamber,source_urls")
    .ilike("title", "%immigration%");
  if (error) throw error;
  const dossier = (data ?? []).find(d => (d.title || "").toLowerCase().includes(needle)) || (data ?? [])[0];
  if (!dossier) { console.error("Aucun dossier trouvé."); return; }
  console.log("Dossier :", dossier.title);
  console.log("Sources :", dossier.source_urls);

  const expose = await fetchExposeText(dossier.source_urls);
  console.log(`\nExposé des motifs extrait : ${expose ? expose.length + " caractères" : "NON TROUVÉ"}`);
  if (expose) console.log("  » " + expose.slice(0, 240) + "…");

  const officialFacts = { dossier, expose_des_motifs: expose, steps: [], amendments: [], scrutins: [] };
  const response = await resilientDeepSeek.createMessage({
    model: "deepseek-chat", max_tokens: 16000, responseFormat: "json_object",
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(officialFacts) }],
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  const parsed = match ? JSON.parse(match[0]) : {};
  console.log("\n===== PUBLIC =====\n" + (parsed.public_summary || "(vide)"));
  console.log("\n===== PREMIUM =====\n" + (parsed.premium_summary || "(vide)"));
}

main().catch(e => { console.error(e); process.exit(1); });
