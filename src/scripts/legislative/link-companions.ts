import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { legislativeTitleMatchScore } from "../../lib/legislative/normalization.js";

// Relie chaque dossier de loi PROMULGUÉE sans scrutin à son dossier « frère » (autre chambre, même
// loi) qui porte les votes/amendements, via companion_dossier_id. Le RPC de détail agrège alors les
// deux → la fiche montre enfin les scrutins. Appariement STRICT (titre canonique >= 0.9) pour ne
// jamais relier deux textes différents. Idempotent, relançable (cron possible).
//   Usage : npm run automation:link-companions            (essai à blanc)
//           npm run automation:link-companions -- --apply (applique)
const APPLY = process.argv.includes("--apply");

async function scount(dossierId: string) {
  const { count } = await supabase.from("legislative_scrutins").select("*", { count: "exact", head: true }).eq("dossier_id", dossierId);
  return count || 0;
}

async function main() {
  const { data: pl } = await supabase.from("promulgated_laws").select("dossier_id");
  const promulgatedIds = new Set((pl || []).map(r => r.dossier_id));

  const dossiers: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.from("legislative_dossiers").select("id,official_id,title,companion_dossier_id").in("legislature", [16, 17]).range(off, off + 999);
    if (!data?.length) break;
    dossiers.push(...data);
    if (data.length < 1000) break;
  }
  const byId = new Map(dossiers.map(d => [d.id, d]));

  let linked = 0, examined = 0;
  for (const id of promulgatedIds) {
    const d = byId.get(id);
    if (!d) continue;
    if (await scount(id) > 0) continue;      // a déjà ses scrutins
    examined++;
    // frère = titre quasi identique, avec le plus de scrutins
    const sibs = dossiers.filter(x => x.id !== id && legislativeTitleMatchScore(x.title, d.title) >= 0.9);
    let best: any = null, bestSc = 0;
    for (const s of sibs) { const n = await scount(s.id); if (n > bestSc) { bestSc = n; best = s; } }
    if (!best || bestSc === 0) continue;
    if (d.companion_dossier_id === best.id) { linked++; continue; } // déjà relié
    console.log(`${APPLY ? "🔗" : "•"} « ${String(d.title).slice(0, 46)} » → frère ${best.official_id} (${bestSc} scrutins)`);
    if (APPLY) {
      const { error } = await supabase.from("legislative_dossiers").update({ companion_dossier_id: best.id, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) { console.error(`  ❌ ${error.message}`); continue; }
    }
    linked++;
  }
  console.log(`\n${examined} lois promulguées sans scrutin examinées ; ${linked} reliées à un frère.${APPLY ? "" : " (essai à blanc — --apply pour écrire)"}`);
}

main().catch(e => { console.error(e); process.exit(1); });
