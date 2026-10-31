import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { verifierControverse } from "../../lib/verification-article.js";

/**
 * Relit dans de vrais articles les entrées automatiques de « Controverses » (31/10/2026, décision de
 * l'éditeur). Confirmée : sources réelles et verifie_le. Fait confirmé mais détails non : réécrite
 * d'après les articles. Sinon : masquée avec son motif (verif_motif), jamais supprimée. Une panne
 * passagère ne masque rien : l'entrée sera relue au prochain lancement.
 */
async function main() {
  // Entrées non relues, et celles masquées par la relecture (une affaire réelle peut l'avoir été pour un
  // détail : elle est corrigée d'après les articles). Jamais celles masquées à la main (sans motif).
  const { data, error } = await supabase.from("controverses_veille").select("id, personne, texte, remplace, masquee, verif_motif")
    .eq("origine", "veille").is("verifie_le", null).order("id");
  if (error) throw error;
  const remplacees = new Set((data ?? []).map(e => e.remplace).filter(Boolean));
  let ok = 0, corrigees = 0, masquees = 0, pannes = 0, passees = 0;
  for (const e of data ?? []) {
    if (e.masquee && !e.verif_motif) continue;
    // Version intermédiaire d'une affaire, déjà remplacée par une entrée plus récente.
    if (remplacees.has(e.texte)) { passees++; continue; }
    let v;
    try { v = await verifierControverse(e.personne, e.texte, { developpement: !!e.remplace }); }
    catch (err: any) { pannes++; console.log(`  ! ${e.personne} : ${err.message}`); continue; }
    if (v.ok === false && /sans réponse/.test(v.motif)) { pannes++; continue; }
    const maj: any = v.ok === true
      ? { verifie_le: new Date().toISOString(), sources: v.sources, verif_motif: null, masquee: false,
          ...(v.corrige ? { texte: v.corrige, remplace: e.texte } : {}) }
      : { masquee: true, verif_motif: v.motif };
    const { error: err } = await supabase.from("controverses_veille").update(maj).eq("id", e.id);
    if (err) { pannes++; console.log(`  ! ${e.personne} : ${err.message}`); continue; }
    if (v.ok === true) { if (v.corrige) corrigees++; else ok++; } else masquees++;
    console.log(`${v.ok === true ? (v.corrige ? "CORRIGÉE" : "OK") : "MASQUÉE"} ${e.personne}${v.ok === true ? "" : ` (${v.motif})`}`);
  }
  console.log(`[Audit] ${ok} confirmée(s), ${corrigees} corrigée(s), ${masquees} masquée(s), ${passees} remplacée(s), ${pannes} panne(s).`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
