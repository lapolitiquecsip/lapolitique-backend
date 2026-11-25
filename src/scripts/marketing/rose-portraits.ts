import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { aExecuter, aRevoir, executee, noter } from "../../lib/qg.js";

/**
 * Rose (graphiste) applique le choix d'Hippolyte sur les portraits (25/11/2026).
 *
 * scripts/visuels/detourer.py --proposer dépose pour chaque candidat une demande « choisir_portrait »
 * avec jusqu'à 3 photos récentes libres de droits, déjà détourées (stockage publications/portraits/
 * propositions/<slug>/<n>.png). Sur WhatsApp : ✅ = la n° 1 ; ✏️ puis « 2 » ou « 3 » = une autre ;
 * ✏️ avec une image jointe = sa propre photo (à détourer par detourer.py --depuis) ; ❌ = on garde
 * l'actuel. Le portrait retenu devient publications/portraits/<slug>.png (+ crédit en .json).
 */
const NOEMIE = "tache:back:publications-reseaux.yml";
const ACTION = "choisir_portrait";
const B = supabase.storage.from("publications");

async function retenir(d: any, n: number) {
  const a = d.apercu ?? {};
  const o = (a.options ?? [])[n - 1];
  if (!a.slug || !o?.png) { console.log(`::warning::${d.titre} : photo n° ${n} introuvable`); return false; }
  const source = `portraits/propositions/${a.slug}/${n}.png`;
  await B.remove([`portraits/${a.slug}.png`]);
  const { error } = await B.copy(source, `portraits/${a.slug}.png`);
  if (error) { console.log(`::warning::${a.slug} : ${error.message}`); return false; }
  await B.upload(`portraits/${a.slug}.json`, JSON.stringify({ ...(o.credit_json ?? {}), choisi_le: new Date().toISOString() }), { contentType: "application/json", upsert: true });
  await executee(d, { portrait: B.getPublicUrl(`portraits/${a.slug}.png`).data.publicUrl, photo: n });
  console.log(`Portrait retenu : ${a.slug} (photo ${n}).`);
  return true;
}

async function main() {
  for (const d of await aExecuter(NOEMIE, ACTION)) await retenir(d, 1);
  for (const d of (await aRevoir(NOEMIE)).filter(x => x.action === ACTION)) {
    const consigne = d.commentaire ?? "";
    const image = /📎\s*(https:\/\/\S+)/.exec(consigne)?.[1];
    const n = Number(/\b([1-3])\b/.exec(consigne)?.[1] ?? 0);
    if (n) { await retenir(d, n); continue; }
    if (image) {
      // Sa propre photo : le détourage demande le modèle U²-Net (Python), fait à part.
      await supabase.from("qg_demandes").update({ statut: "annulee", resultat: { a_detourer: image } }).eq("id", d.id);
      await noter({ agent: NOEMIE, equipe: "marketing", genre: "info", demande: d.id, lien: image,
        message: `Rose détourera ta photo pour ${(d.apercu as any)?.slug} (python scripts/visuels/detourer.py --depuis <image> --slug <slug>).` });
      continue;
    }
    console.log(`::notice::${d.titre} : consigne sans numéro ni image (« ${consigne.slice(0, 80)} »), laissée en attente.`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.log(`::error::${String(e?.message ?? e).slice(0, 400)}`); process.exit(1); });
