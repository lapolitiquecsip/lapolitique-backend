import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { verifierControverse } from "../../lib/verification-article.js";

/**
 * Relit dans de vrais articles les entrées automatiques de « Controverses » (31/10/2026, décision de
 * l'éditeur). Confirmée : sources réelles et verifie_le. Sinon : masquée avec son motif (verif_motif),
 * jamais supprimée. Une panne passagère ne masque rien : l'entrée sera relue au prochain lancement.
 */
async function main() {
  const { data, error } = await supabase.from("controverses_veille").select("id, personne, texte, remplace")
    .eq("origine", "veille").eq("masquee", false).is("verifie_le", null).order("id");
  if (error) throw error;
  let ok = 0, masquees = 0, pannes = 0;
  for (const e of data ?? []) {
    let v;
    try { v = await verifierControverse(e.personne, e.texte, { developpement: !!e.remplace }); }
    catch (err: any) { pannes++; console.log(`  ! ${e.personne} : ${err.message}`); continue; }
    if (v.ok === false && /sans réponse/.test(v.motif)) { pannes++; continue; }
    const maj = v.ok === true ? { verifie_le: new Date().toISOString(), sources: v.sources, verif_motif: null } : { masquee: true, verif_motif: v.motif };
    const { error: err } = await supabase.from("controverses_veille").update(maj).eq("id", e.id);
    if (err) { pannes++; console.log(`  ! ${e.personne} : ${err.message}`); continue; }
    if (v.ok === true) ok++; else masquees++;
    console.log(`${v.ok === true ? "OK" : "MASQUÉE"} ${e.personne}${v.ok === true ? "" : ` (${v.motif})`}`);
  }
  console.log(`[Audit] ${ok} confirmée(s), ${masquees} masquée(s), ${pannes} panne(s).`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
