import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { annuaireSenat, lireFicheSenat } from "../../lib/senat-fiche.js";

/**
 * Groupe et commission de chaque sénateur en fonction, lus sur sa fiche senat.fr.
 *
 * L'open data ODSEN suit avec retard (après le renouvellement de 2026, il affichait
 * « Aucun » pour 179 sénateurs quand senat.fr donnait déjà leur groupe). Une page
 * qui ne dit rien ne modifie rien : on n'efface jamais une valeur faute d'information.
 */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const annuaire = await annuaireSenat();
  if (annuaire.size < 300) throw new Error(`Annuaire senat.fr anormal (${annuaire.size} fiches) : structure de la page changée ?`);

  const { data, error } = await supabase.from("senators")
    .select("id, first_name, last_name, senate_matricule, senate_group, committee, profession, email").neq("sitting", false);
  if (error) throw error;

  let lus = 0, groupes = 0, commissions = 0, introuvables: string[] = [];
  const parGroupe = new Map<string, number>();
  const file = [...(data || [])];
  const travail = async () => {
    for (let s = file.shift(); s; s = file.shift()) {
      const url = s.senate_matricule ? annuaire.get(String(s.senate_matricule).toLowerCase()) : undefined;
      if (!url) { introuvables.push(`${s.first_name} ${s.last_name}`); continue; }
      const f = await lireFicheSenat(url);
      await sleep(600);
      if (!f) { introuvables.push(`${s.first_name} ${s.last_name}`); continue; }
      lus++;
      if (f.groupe) parGroupe.set(f.groupe, (parGroupe.get(f.groupe) || 0) + 1);
      const patch: Record<string, string> = {};
      if (f.groupe && f.groupe !== s.senate_group) { patch.senate_group = f.groupe; groupes++; }
      if (f.commission && f.commission !== s.committee) { patch.committee = f.commission; commissions++; }
      // Profession et adresse : complétées si absentes, jamais écrasées.
      if (f.profession && !s.profession) patch.profession = f.profession;
      if (f.email && !s.email) patch.email = f.email;
      if (Object.keys(patch).length) {
        const { error: e } = await supabase.from("senators").update(patch).eq("id", s.id);
        if (e) console.warn(`  ! ${s.first_name} ${s.last_name} : ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 2 }, travail));   // senat.fr refuse les rafales

  console.log(`[Sénat] ${lus} fiches lues, ${groupes} groupe(s) et ${commissions} commission(s) mis à jour.`);
  console.log(`[Sénat] Répartition relevée : ${[...parGroupe].sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${n}`).join(" · ")}`);
  if (introuvables.length) console.log(`::warning::${introuvables.length} fiche(s) senat.fr introuvable(s) : ${introuvables.slice(0, 10).join(", ")}`);
}

main().then(() => { process.exitCode = 0; }).catch(e => { console.error(e); process.exitCode = 1; });
