import "dotenv/config";
import { supabase } from "../../config/supabase.js";

/**
 * Essai de bout en bout du versement automatique des commissions (Stripe en MODE TEST) :
 *  1. compte de parrain fictif complet chez Stripe (identité + IBAN de test) ;
 *  2. une commission réelle de test rendue « disponible » (date reculée, seuil abaissé) ;
 *  3. la vraie tâche quotidienne « verser » → transfert Stripe, commission « versée » ;
 *  4. remboursement du paiement du filleul → webhook → commission annulée, transfert repris ;
 *  5. tout est remis en état (seuil, parrain, compte fictif supprimé).
 * Usage : npx tsx src/scripts/automation/essai-versement-parrainage.ts [--sans-remboursement]
 */
const URL_FN = `${process.env.SUPABASE_URL}/functions/v1/parrainage-versements`;
const appel = async (corps: any) => {
  const r = await fetch(URL_FN, { method: "POST", headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(corps) });
  return r.json();
};
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const compte = await appel({ action: "essai_compte" });
  console.log("1. Compte fictif :", compte);
  if (!compte.compte) throw new Error("Création impossible (Connect activé dans Stripe, mode test ?)");

  const { data: c } = await supabase.from("commissions").select("*").eq("statut", "en_attente").order("creee_le").limit(1).maybeSingle();
  if (!c) throw new Error("Aucune commission en attente pour l'essai.");
  const { data: p } = await supabase.from("parrains").select("*").eq("user_id", c.parrain_id).single();
  const { data: reg } = await supabase.from("parrainage_reglages").select("*").limit(1).single();
  console.log(`2. Commission ${c.id} : ${c.commission} € (facture ${c.stripe_facture})`);

  try {
    await supabase.from("parrains").update({ stripe_compte: compte.compte, versements_actifs: false }).eq("user_id", c.parrain_id);
    await supabase.from("commissions").update({ creee_le: new Date(Date.now() - 40 * 864e5).toISOString() }).eq("id", c.id);
    await supabase.from("parrainage_reglages").update({ seuil_versement: 0.5 }).eq("id", reg.id);

    const v = await appel({ action: "verser" });
    console.log("3. Tâche verser :", JSON.stringify(v));
    const { data: apres } = await supabase.from("commissions").select("statut, stripe_transfert, erreur_versement, versee_le").eq("id", c.id).single();
    console.log("   Commission après versement :", apres);
    if (apres?.stripe_transfert) console.log("   Transfert chez Stripe :", await appel({ action: "essai_transfert", transfert: apres.stripe_transfert }));

    if (apres?.stripe_transfert && !process.argv.includes("--sans-remboursement")) {
      console.log("4. Remboursement du paiement :", await appel({ action: "essai_rembourser", facture: c.stripe_facture }));
      for (let i = 0; i < 12; i++) {
        await pause(5000);
        const { data: x } = await supabase.from("commissions").select("statut").eq("id", c.id).single();
        if (x?.statut === "annulee") break;
      }
      const { data: fin } = await supabase.from("commissions").select("statut").eq("id", c.id).single();
      console.log("   Commission après remboursement :", fin?.statut);
      console.log("   Transfert :", await appel({ action: "essai_transfert", transfert: apres.stripe_transfert }));
    }
  } finally {
    await supabase.from("parrainage_reglages").update({ seuil_versement: reg.seuil_versement }).eq("id", reg.id);
    await supabase.from("parrains").update({ stripe_compte: p.stripe_compte, versements_actifs: p.versements_actifs }).eq("user_id", c.parrain_id);
    console.log("5. Remis en état (seuil, parrain). Compte fictif :", await appel({ action: "essai_supprimer", compte: compte.compte }));
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
