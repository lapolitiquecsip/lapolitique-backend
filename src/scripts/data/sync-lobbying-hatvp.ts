import "dotenv/config";
import fs from "fs";
import { supabase } from "../../config/supabase.js";

/**
 * Répertoire des représentants d'intérêts (HATVP, open data « Agora ») : chaque activité de
 * lobbying déclarée — objet, domaines, décideurs publics ciblés, actions menées — pour répondre
 * à « qui fait du lobbying sur ce sujet ? » dans l'onglet « Qui pèse » (Pro).
 *
 * Source : un seul fichier JSON (≈ 140 Mo) mis à jour chaque jour par la HATVP. Relu chaque
 * semaine en entier ; une activité retirée du répertoire est retirée de la table. Aucune IA.
 *   --dry            n'écrit rien, affiche le volume
 *   --fichier=…      fichier déjà téléchargé
 */
const DRY = process.argv.includes("--dry");
const SOURCE = "https://www.hatvp.fr/agora/opendata/agora_repertoire_opendata.json";
const date = (s?: string | null) => { const m = String(s || "").match(/(\d{2})[-/](\d{2})[-/](\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
/** « Membre du Gouvernement ou membre de cabinet ministériel - Economie et finances » → « Cabinet ministériel : Economie et finances ». */
const cible = (s: string) => s.replace(/^Membre du Gouvernement ou membre de cabinet minist[ée]riel - /, "Cabinet ministériel : ")
  .replace(/^D[ée]put[ée], s[ée]nateur.*$/, "Parlementaires et leurs collaborateurs").replace(/^Collaborateur du Pr[ée]sident de la R[ée]publique$/, "Élysée");

async function main() {
  const local = process.argv.find(a => a.startsWith("--fichier="))?.split("=").slice(1).join("=");
  let brut: string;
  if (local) brut = fs.readFileSync(local, "utf8");
  else {
    // Le fichier fait plusieurs dizaines de mégaoctets : une coupure en route faisait échouer
    // tout le passage (09/11/2026). Quatre essais espacés.
    let derniere: unknown = null;
    brut = "";
    for (let essai = 1; essai <= 4 && !brut; essai++) {
      try {
        const r = await fetch(SOURCE, { signal: AbortSignal.timeout(20 * 60000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const t = await r.text();
        JSON.parse(t);
        brut = t;
      } catch (e) {
        derniere = e;
        console.warn(`[HATVP] téléchargement, essai ${essai}/4 : ${(e as Error).message}`);
        if (essai < 4) await new Promise(x => setTimeout(x, 30_000 * essai));
      }
    }
    if (!brut) throw derniere;
  }
  const publications: any[] = JSON.parse(brut).publications || [];
  const debutPassage = new Date().toISOString();
  const lignes: any[] = [];
  for (const o of publications) {
    const secteurs = (o.activites?.listSecteursActivites || []).map((s: any) => s.label).filter(Boolean);
    const url = o.identifiantNational ? `https://www.hatvp.fr/fiche-organisation/?organisation=${encodeURIComponent(o.identifiantNational)}` : null;
    for (const ex of o.exercices || []) {
      const pc = ex.publicationCourante || {};
      for (const a of pc.activites || []) {
        const ac = a.publicationCourante || {};
        if (!ac.identifiantFiche || !ac.objet) continue;
        const actions = ac.actionsRepresentationInteret || [];
        lignes.push({
          id: ac.identifiantFiche,
          organisation: o.nomUsage || o.denomination, siren: o.identifiantNational || null,
          categorie: o.categorieOrganisation?.label || null, secteurs,
          objet: String(ac.objet).slice(0, 2000),
          domaines: ac.domainesIntervention || [],
          cibles: [...new Set(actions.flatMap((x: any) => (x.reponsablesPublics || []).map(cible)))],
          decisions: [...new Set(actions.flatMap((x: any) => x.decisionsConcernees || []))],
          actions: [...new Set(actions.flatMap((x: any) => x.actionsMenees || []))],
          exercice_debut: date(pc.dateDebut), exercice_fin: date(pc.dateFin),
          publie_le: date(ac.publicationDate), url, maj_le: debutPassage,
        });
      }
    }
  }
  console.log(`[HATVP] ${publications.length} représentant(s), ${lignes.length} activité(s) déclarée(s)${DRY ? " — ESSAI" : ""}.`);
  if (DRY) { for (const l of lignes.slice(0, 2)) console.log(" ", JSON.stringify(l).slice(0, 400)); return; }
  // Par lots de 500, chacun repris trois fois : un lot de 1 000 dépassait parfois le délai de la base.
  for (let i = 0; i < lignes.length; i += 500) {
    for (let essai = 1; ; essai++) {
      const { error } = await supabase.from("lobbying_activites").upsert(lignes.slice(i, i + 500), { onConflict: "id" });
      if (!error) break;
      if (essai >= 3) throw error;
      console.warn(`[HATVP] lot ${i}, essai ${essai}/3 : ${error.message}`);
      await new Promise(x => setTimeout(x, 10_000 * essai));
    }
  }
  // Ce que la HATVP ne publie plus (activité retirée, organisation radiée) disparaît aussi ici.
  const { error } = await supabase.from("lobbying_activites").delete().lt("maj_le", debutPassage);
  if (error) throw error;
  console.log(`[HATVP] ${lignes.length} activité(s) à jour.`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
