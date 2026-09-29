import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { quasiDoublon } from "../../lib/quasi-doublon.js";

// Nettoyage ponctuel des quasi-doublons déjà en base : le même fait repris par deux
// journaux, entré deux fois dans le fil d'un territoire (entity_feed) puis dans les
// alertes des membres (user_notifications). On garde le PREMIER arrivé.
//
// La collecte et la création des alertes filtrent désormais ces doublons
// (src/lib/quasi-doublon.ts) ; ce script ne sert qu'à rattraper l'existant.
//
// Usage : npx tsx src/scripts/automation/nettoyer-quasi-doublons.ts [--jours=60] [--dry]

const JOURS = Number(process.argv.find(a => a.startsWith("--jours="))?.split("=")[1] || 60);
const DRY = process.argv.includes("--dry");

async function tout(table: string, select: string, filtre: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtre(supabase.from(table).select(select)).order("created_at").range(de, de + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Dans chaque groupe (même territoire, même membre), les lignes dont un titre antérieur dit la même chose. */
const paires: string[] = [];
function doublons(lignes: any[], groupe: (l: any) => string): string[] {
  const vus = new Map<string, string[]>();
  const aRetirer: string[] = [];
  for (const l of lignes) {
    const g = groupe(l);
    const titres = vus.get(g) || [];
    const jumeau = titres.find(t => quasiDoublon(t, l.title, l.place || ""));
    if (jumeau) { aRetirer.push(l.id); paires.push(`${jumeau}  ≈  ${l.title}`); }
    else vus.set(g, [...titres, l.title]);
  }
  return aRetirer;
}

async function retirer(table: string, ids: string[]) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from(table).delete().in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`${table} : ${error.message}`);
  }
}

async function main() {
  const depuis = new Date(Date.now() - JOURS * 86400000).toISOString();

  const feed = await tout("entity_feed", "id, entity_type, entity_id, title, place, created_at",
    // Les fils de ministères (actes du Journal officiel) sont exclus : leurs intitulés
    // récurrents (« Nomination (enseignement supérieur) ») se ressemblent sans se répéter.
    q => q.gte("created_at", depuis).in("entity_type", ["commune", "department", "region", "party"]));
  const feedDoublons = doublons(feed, l => `${l.entity_type}:${l.entity_id}`);

  const notifs = await tout("user_notifications", "id, user_id, title, place, created_at", q => q.eq("type", "local").gte("created_at", depuis));
  const notifDoublons = doublons(notifs, l => l.user_id);

  console.log(`> Fil des territoires : ${feedDoublons.length} doublon(s) sur ${feed.length}.`);
  console.log(`> Alertes locales : ${notifDoublons.length} doublon(s) sur ${notifs.length}.`);
  if (DRY) {
    for (const p of paires.filter((_, i) => i % Math.max(1, Math.floor(paires.length / 25)) === 0).slice(0, 25)) console.log("   ·", p);
    console.log("--- DRY-RUN : rien retiré ---");
    return;
  }
  await retirer("user_notifications", notifDoublons);
  await retirer("entity_feed", feedDoublons);
  console.log("--- TERMINÉ ---");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
