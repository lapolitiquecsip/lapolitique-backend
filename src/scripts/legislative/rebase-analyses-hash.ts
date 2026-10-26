import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { PROMPT_VERSION, empreinteAnalyse, empreinteHistorique, faitsOfficiels } from "./summarize.js";

// Migration ponctuelle (26/10/2026) : l'empreinte des analyses ne dépend plus de la catégorie
// ni de source_hash (cf. empreinteAnalyse). Sans cette migration, le prochain passage de
// summarize.ts aurait jugé « modifiés » tous les dossiers de sa fenêtre (lois promulguées +
// 50 dossiers actifs) et relancé leurs analyses DeepSeek alors que leurs faits n'ont pas bougé.
//
// Pour chaque dossier de la fenêtre : si une analyse porte l'empreinte calculée à l'ancienne
// sur les faits d'aujourd'hui, elle reçoit la nouvelle empreinte. Une analyse dont les faits ont
// changé depuis ne correspond pas, et sera refaite normalement.
// À lancer AVANT de modifier les catégories en base (l'ancienne formule les contient).
//   Usage : npx tsx src/scripts/legislative/rebase-analyses-hash.ts           (essai à blanc)
//           npx tsx src/scripts/legislative/rebase-analyses-hash.ts --apply   (écrit)
const APPLY = process.argv.includes("--apply");
const FIELDS = "id,title,text_type,author_name,category,status_label,current_chamber,source_urls,source_hash";

async function fenetre(): Promise<any[]> {
  const { data: promulguees } = await supabase.from("promulgated_laws").select("dossier_id");
  const ids = new Set((promulguees ?? []).map(r => r.dossier_id));
  const limite = Math.max(1, Number(process.env.LEGISLATIVE_SUMMARY_LIMIT ?? 50));
  let cursorDate: string | null = null, cursorId: string | null = null, actifs = 0;
  while (actifs < limite) {
    const pageSize = Math.min(100, limite - actifs);
    const { data: page, error } = await supabase.rpc("public_legislative_dossiers", { p_limit: pageSize, p_cursor_date: cursorDate, p_cursor_id: cursorId });
    if (error) throw error;
    if (!page?.length) break;
    for (const row of page as any[]) ids.add(row.id);
    actifs += page.length;
    const last = page.at(-1) as any;
    cursorDate = last.source_updated_at; cursorId = last.id;
    if (page.length < pageSize) break;
  }
  const dossiers: any[] = [];
  const liste = [...ids];
  for (let i = 0; i < liste.length; i += 100) {
    const { data, error } = await supabase.from("legislative_dossiers").select(FIELDS).in("id", liste.slice(i, i + 100));
    if (error) throw error;
    dossiers.push(...(data ?? []));
  }
  return dossiers;
}

async function main() {
  const dossiers = await fenetre();
  console.log(`> ${dossiers.length} dossiers dans la fenêtre d'analyse.`);
  let rebases = 0, deja = 0, perimes = 0, sansAnalyse = 0;
  for (const dossier of dossiers) {
    const faits = await faitsOfficiels(dossier);
    if (!faits) { console.warn(`  ⚠ faits indisponibles : ${dossier.id}`); continue; }
    const ancien = empreinteHistorique(faits.officialFacts);
    const nouveau = empreinteAnalyse(faits.officialFacts);
    const { data: analyses } = await supabase.from("legislative_analyses").select("id,input_hash")
      .eq("dossier_id", dossier.id).eq("prompt_version", PROMPT_VERSION);
    if (!analyses?.length) { sansAnalyse++; continue; }
    if (analyses.some(a => a.input_hash === nouveau)) { deja++; continue; }
    const cibles = analyses.filter(a => a.input_hash === ancien);
    if (!cibles.length) { perimes++; continue; }
    if (APPLY) {
      const { error } = await supabase.from("legislative_analyses").update({ input_hash: nouveau })
        .in("id", cibles.map(a => a.id));
      if (error) { console.error(`  ❌ ${dossier.id} : ${error.message}`); continue; }
    }
    rebases++;
  }
  console.log(`--- ${rebases} dossiers ${APPLY ? "rebasés" : "à rebaser"}, ${deja} déjà à jour, ${perimes} aux faits changés (seront refaits), ${sansAnalyse} sans analyse.${APPLY ? "" : " (essai à blanc — --apply pour écrire)"} ---`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
