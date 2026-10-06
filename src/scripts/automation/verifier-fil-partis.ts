import "dotenv/config";
import { supabase } from "../../config/supabase.js";

/**
 * Alarme du fil des partis : si plus rien n'y est entré depuis 48 h, le job échoue,
 * ce qui déclenche l'e-mail d'échec de GitHub Actions. Le 4 septembre 2026, le fil s'était
 * arrêté sans bruit (quota IA épuisé avant d'atteindre les partis) pendant un mois.
 */
const HEURES = Number(process.env.FIL_PARTIS_ALERTE_HEURES || 48);

async function main() {
  const { data } = await supabase.from("entity_feed").select("created_at")
    .eq("entity_type", "party").order("created_at", { ascending: false }).limit(1);
  const dernier = data?.[0]?.created_at ? new Date(data[0].created_at) : null;
  const age = dernier ? (Date.now() - dernier.getTime()) / 3600000 : Infinity;
  console.log(`[Fil partis] Dernière entrée : ${dernier?.toISOString() ?? "aucune"} (${Math.round(age)} h).`);
  if (age > HEURES) {
    console.log(`::error::Fil des partis à l'arrêt depuis ${Math.round(age)} h : vérifier les flux et l'IA.`);
    process.exit(1);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
