import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { legislativeTitleMatchScore } from "../../lib/legislative/normalization.js";

// Audit des rattachements JORF (loi promulguée) → dossier parlementaire. Le lien se fait par
// ressemblance de titre ; un texte adverse (« ... abroger la loi visant à ... ») pouvait obtenir
// un score de 1.0 par simple inclusion et coiffer le vrai dossier. Ce script recalcule, pour
// chaque loi promulguée, le meilleur dossier avec le score corrigé, et signale/repare les liens
// erronés. --apply pour écrire ; sinon dry-run (n'écrit rien).
const APPLY = process.argv.includes("--apply");

type Dossier = { id: string; official_id: string; title: string };

function best(lawTitle: string, dossiers: Dossier[]) {
  let top: { d: Dossier; score: number } | null = null;
  for (const d of dossiers) {
    const score = legislativeTitleMatchScore(d.title, lawTitle);
    if (score < 0.5) continue;
    if (!top || score > top.score
      // tie-break : dossier AN de la législature en cours, puis titre le plus court (le texte
      // d'origine, pas une variante englobante), puis stabilité par identifiant.
      || (score === top.score && rank(d) > rank(top.d))) {
      top = { d, score };
    }
  }
  return top;
}
function rank(d: Dossier): number {
  let r = 0;
  if (/^DLR5L17/i.test(d.official_id)) r += 100;          // AN, législature courante
  else if (/^DLR5L/i.test(d.official_id)) r += 40;        // AN autre législature
  else if (/^SENAT:/i.test(d.official_id)) r += 20;       // Sénat
  r += Math.max(0, 60 - Math.min(60, d.title.length / 4)); // titres courts favorisés
  if (/\b(abroger|abrogation|abrogeant)\b/i.test(d.title)) r -= 500; // jamais un texte d'abrogation
  return r;
}

async function loadAllDossiers(): Promise<Dossier[]> {
  const out: Dossier[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("legislative_dossiers")
      .select("id, official_id, title")
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...(data as Dossier[]));
    if (data.length < page) break;
  }
  return out;
}

async function main() {
  console.log(`--- AUDIT RATTACHEMENTS JORF→DOSSIER ${APPLY ? "(APPLY)" : "(dry-run)"} ---`);
  const dossiers = await loadAllDossiers();
  const byId = new Map(dossiers.map(d => [d.id, d]));
  console.log(`> ${dossiers.length} dossiers chargés.`);

  const { data: laws, error } = await supabase
    .from("promulgated_laws")
    .select("jorf_id, dossier_id, title");
  if (error) throw error;
  console.log(`> ${laws?.length ?? 0} lois promulguées à auditer.\n`);

  const fixes: Array<{ jorf: string; from: string | null; to: string; law: string }> = [];
  const review: string[] = [];
  for (const law of laws ?? []) {
    const top = best(law.title, dossiers);
    if (!top) continue;                          // aucun bon candidat : on n'y touche pas
    if (top.d.id === law.dossier_id) continue;   // déjà bien rattaché
    const cur = law.dossier_id ? byId.get(law.dossier_id) : null;
    const line = `${law.title.slice(0, 78)}\n    actuel : ${cur ? `${cur.official_id} — ${cur.title.slice(0, 66)}` : "(aucun)"}\n    correct: ${top.d.official_id} — ${top.d.title.slice(0, 66)} [${top.score.toFixed(2)}]`;
    if (top.score >= 0.999) {                    // exact : correction sûre, appliquée
      fixes.push({ jorf: law.jorf_id, from: law.dossier_id, to: top.d.id, law: law.title });
      console.log(`✔︎  ${line}\n`);
    } else {                                     // partiel : signalé, JAMAIS appliqué auto
      review.push(line);
    }
  }

  if (review.length) {
    console.log(`\n=== ${review.length} cas PARTIELS (non appliqués — à vérifier à la main) ===`);
    for (const r of review) console.log(`?  ${r}\n`);
  }
  console.log(`=== ${fixes.length} correction(s) EXACTE(S) à appliquer sur ${laws?.length ?? 0}. ===`);
  if (APPLY && fixes.length) {
    for (const f of fixes) {
      const { error: e } = await supabase.from("promulgated_laws").update({ dossier_id: f.to }).eq("jorf_id", f.jorf);
      if (e) console.error(`  échec ${f.jorf}: ${e.message}`);
    }
    // Marque les bons dossiers comme promulgués (façade de statut cohérente).
    for (const f of fixes) {
      await supabase.from("legislative_dossiers")
        .update({ status_code: "promulgated", status_label: "Promulguée", current_chamber: "JORF", updated_at: new Date().toISOString() })
        .eq("id", f.to);
    }
    console.log(`--- ${fixes.length} lois re-rattachées. Régénérer titres + impacts ensuite. ---`);
    // Émet les dossier_id corrigés pour les scripts de régénération.
    console.log("DOSSIERS_CORRIGES=" + fixes.map(f => f.to).join(","));
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
