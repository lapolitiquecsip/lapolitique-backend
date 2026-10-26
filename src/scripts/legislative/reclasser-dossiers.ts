import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { classifyDossier } from "../../lib/legislative/normalization.js";

// Recalcule la catégorie thématique de tous les dossiers après une retouche du classeur
// (normalization.ts) ou l'ajout d'une correction manuelle (categories-corrigees.ts).
// N'écrit que la colonne category, et seulement là où elle change. Les synchronisations
// Assemblée et Sénat appliqueront de toute façon le même classeur à leur prochain passage ;
// ce script couvre aussi les dossiers qu'elles ne revoient plus (législatures closes).
//   Usage : npm run automation:legislative:reclasser            (essai à blanc)
//           npm run automation:legislative:reclasser -- --apply (écrit)
const APPLY = process.argv.includes("--apply");

async function main() {
  const dossiers: { id: string; official_id: string; title: string; category: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("legislative_dossiers").select("id, official_id, title, category").range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    dossiers.push(...data);
    if (data.length < 1000) break;
  }
  const changements = new Map<string, string[]>();
  for (const d of dossiers) {
    const categorie = classifyDossier(d.official_id, d.title);
    if (categorie !== d.category) changements.set(categorie, [...(changements.get(categorie) || []), d.id]);
  }
  const total = [...changements.values()].reduce((n, ids) => n + ids.length, 0);
  console.log(`> ${dossiers.length} dossiers, ${total} changent de catégorie.`);
  for (const [categorie, ids] of changements) {
    console.log(`  ${categorie} : ${ids.length}`);
    if (!APPLY) continue;
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from("legislative_dossiers").update({ category: categorie }).in("id", ids.slice(i, i + 200));
      if (error) throw error;
    }
  }
  console.log(APPLY ? "--- Catégories écrites. ---" : "--- Essai à blanc — --apply pour écrire. ---");
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
