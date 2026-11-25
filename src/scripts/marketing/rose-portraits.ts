import "dotenv/config";
import { appendFileSync } from "node:fs";
import { supabase } from "../../config/supabase.js";
import { aExecuter, aRevoir, executee, noter } from "../../lib/qg.js";

/**
 * Rose (graphiste) applique le choix d'Hippolyte sur les portraits (25/11/2026).
 *
 * scripts/visuels/detourer.py --proposer dépose pour chaque candidat une demande « choisir_portrait »
 * avec jusqu'à 3 photos récentes libres de droits, déjà détourées (stockage publications/portraits/
 * propositions/<slug>/<n>.png). Sur WhatsApp : ✅ = la n° 1 ; ✏️ puis « 2 » ou « 3 » = une autre ;
 * ✏️ avec une image jointe = sa propre photo (détourée sur GitHub par detourer.py --recus) ; ❌ = on garde
 * l'actuel. Le portrait retenu devient publications/portraits/<slug>.png (+ crédit en .json).
 *
 * En fin de passage, dit à GitHub s'il y a du détourage à faire (sorties `recus` et `manquants`) :
 * l'étape Python (onnxruntime + modèles, ~3 min) ne s'installe que dans ce cas.
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
        message: `Rose détoure ta photo pour ${(d.apercu as any)?.slug} (dans la foulée, sur GitHub).` });
      continue;
    }
    console.log(`::notice::${d.titre} : consigne sans numéro ni image (« ${consigne.slice(0, 80)} »), laissée en attente.`);
  }
  await travailDeDetourage();
}

/** Photos envoyées à détourer, et candidats avec un programme mais sans portrait ni demande ouverte. */
async function travailDeDetourage() {
  const { count: recus } = await supabase.from("qg_demandes").select("id", { count: "exact", head: true })
    .eq("action", ACTION).eq("statut", "annulee").not("resultat->>a_detourer", "is", null).is("resultat->>fait", null);
  const { data: gens } = await supabase.from("presidential_candidates").select("id, slug").eq("status", "declared").not("photo_url", "is", null);
  // Une requête par candidat : Supabase plafonne à 1 000 lignes (Mélenchon en a plus de 1 800).
  const avecProgramme = new Set<string>();
  for (const g of gens ?? []) {
    const { count } = await supabase.from("candidate_proposals").select("id", { count: "exact", head: true }).eq("candidate_id", g.id);
    if (count) avecProgramme.add(g.id);
  }
  const { data: fichiers } = await B.list("portraits", { limit: 1000 });
  const faits = new Set((fichiers ?? []).map(f => f.name.replace(/\.png$/, "")));
  const { data: ouvertes } = await supabase.from("qg_demandes").select("apercu").eq("action", ACTION).in("statut", ["a_valider", "a_modifier", "validee"]);
  const enCours = new Set((ouvertes ?? []).map((d: any) => d.apercu?.slug));
  const manquants = (gens ?? []).filter((g: any) => avecProgramme.has(g.id) && !faits.has(g.slug) && !enCours.has(g.slug)).length;
  console.log(`Détourage à faire : ${recus ?? 0} photo(s) reçue(s), ${manquants} candidat(s) sans portrait.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, [`recus=${recus ?? 0}`, `manquants=${manquants}`, ""].join("\n"));
}

main().then(() => process.exit(0)).catch(e => { console.log(`::error::${String(e?.message ?? e).slice(0, 400)}`); process.exit(1); });
