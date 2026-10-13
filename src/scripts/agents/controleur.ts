import "dotenv/config";
import fs from "fs";
import { supabase } from "../../config/supabase.js";
import { lireCycle, TERMINALES, type Cycle, type Item } from "../../lib/cycles.js";
import { FAMILLES } from "../../lib/banc.js";

/**
 * LE CONTRÔLEUR — dernier agent de chaque cycle.
 *
 * Sa seule tâche : s'assurer que rien ne reste en route. Il ne détecte, ne rédige ni ne
 * publie ; il lit le journal et répond à une question : « tout ce qui devait être en ligne
 * l'est-il ? ». Il produit un état des lieux par cycle (résumé du passage GitHub), et fait
 * échouer le passage — donc envoie un courriel — quand un objet est bloqué depuis trop
 * longtemps. UNE alerte par blocage : un objet déjà signalé ne redéclenche rien tant qu'il
 * n'a pas bougé.
 *
 * Usage : npx tsx src/scripts/agents/controleur.ts [--sans-alerte]
 */
const SANS_ALERTE = process.argv.includes("--sans-alerte");

/** Délai, en jours, au-delà duquel un objet resté à cette étape est considéré bloqué. */
const DELAIS: Record<Cycle, Record<string, number>> = {
  programmes: { detecte: 2, redige: 1, a_revoir: 0 },
  // Un compte rendu met couramment deux à trois semaines à paraître ; l'analyse suit en un jour.
  auditions: { detecte: 30, collecte: 4 },
};
const NOMS: Record<string, string> = {
  detecte: "détecté, pas encore repris", collecte: "collecté, analyse en attente", redige: "rédigé, à vérifier",
  verifie: "vérifié, prêt à publier", en_ligne: "en ligne", a_transcrire: "vidéo à transcrire",
  sans_source: "sans compte rendu ni vidéo", a_revoir: "à revoir par un humain", ecarte: "écarté",
};

const jours = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 864e5);

/**
 * Le banc d'essai : ce que les agents vérificateur et relecteur ont noté sur les textes
 * publiés, fonctionnalité par fonctionnalité, depuis le début de l'essai. Aucune alerte :
 * c'est une mesure, pas une panne.
 */
async function rapportBanc(): Promise<string[]> {
  const out: string[] = ["## Banc d'essai multi-agents (observation, rien n'est modifié sur le site)", ""];
  const tableau: string[] = [];
  const exemples: string[] = [];
  let debut = "";
  for (const f of FAMILLES) {
    const { data } = await supabase.from("cycle_items").select("etape, titre, erreur, donnees, detecte_le")
      .eq("cycle", `banc:${f.cle}`).limit(5000);
    const items = data ?? [];
    for (const i of items) if (!debut || i.detecte_le < debut) debut = i.detecte_le;
    const n = (e: string) => items.filter(i => i.etape === e).length;
    const lisibles = n("conforme") + n("a_revoir");
    const relus = items.filter(i => i.donnees?.relecteur && !i.donnees.relecteur.non_juge);
    const infideles = relus.filter(i => i.donnees.relecteur.fidele === false);
    const partiaux = relus.filter(i => i.donnees.relecteur.neutre === false);
    // Les deux agents, indépendants l'un de l'autre, désignent le même texte.
    const doubles = infideles.filter(i => i.etape === "a_revoir");

    // Sentinelle : la fonctionnalité produit-elle encore ?
    let q = supabase.from(f.table).select(f.date).not(f.date, "is", null).order(f.date, { ascending: false }).limit(1);
    if (f.filtre) q = f.filtre(q);
    const { data: dernier } = await q;
    const date = (dernier as any)?.[0]?.[f.date];
    const age = date ? Math.round((Date.now() - new Date(date).getTime()) / 36e5) : null;
    const fraicheur = age === null ? "—" : `${age < 48 ? `${age} h` : `${Math.round(age / 24)} j`}${age > f.fraicheur ? " ⚠" : ""}`;

    const pct = (a: number, b: number) => (b ? `${Math.round(100 * a / b)} %` : "—");
    tableau.push(`| ${f.nom} | ${items.length} | ${n("sans_source")} | ${n("a_revoir")} (${pct(n("a_revoir"), lisibles)}) | ${relus.length} | ${infideles.length} (${pct(infideles.length, relus.length)}) | ${partiaux.length} | ${doubles.length} | ${fraicheur} |`);

    for (const i of [...doubles, ...infideles.filter(x => !doubles.includes(x))].slice(0, 2)) {
      const e = (i.donnees.relecteur.erreurs ?? [])[0];
      exemples.push(`- **${f.nom}** — ${String(i.titre ?? "").slice(0, 90)}`
        + (e ? `\n  - relecteur : « ${String(e.extrait).slice(0, 120)} » → ${String(e.probleme).slice(0, 160)}` : "")
        + ((i.donnees.chiffres_absents ?? []).length ? `\n  - vérificateur : nombres absents de la source : ${i.donnees.chiffres_absents.join(" · ")}` : ""));
    }
  }
  if (debut) out.push(`Depuis le ${new Date(debut).toLocaleDateString("fr-FR")}.`, "");
  out.push("| Fonctionnalité | Textes contrôlés | Source illisible | Signalés par le vérificateur | Relus par le 2ᵉ modèle | Jugés infidèles | Jugés non neutres | Signalés par les deux | Dernière production |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|", ...tableau, "");
  out.push("« Signalés par les deux » est la mesure qui compte : un agent sans IA et un modèle d'une autre maison,",
    "sans se concerter, désignent le même texte. « Source illisible » dit qu'aucun agent ne peut vérifier la fonctionnalité telle qu'elle est construite.", "");
  if (exemples.length) out.push("### Exemples", "", ...exemples, "");

  // Recoupement des fils nourris par la presse, sur les quatorze derniers jours. On COMPTE
  // en base au lieu de rapatrier les lignes : la lecture est plafonnée à mille lignes, et le
  // tableau n'en montrait qu'une partie (zéro mention affichée pour cent cinquante réelles).
  const depuis14 = new Date(Date.now() - 14 * 864e5).toISOString();
  const compter = async (fil: string, etat: string | null) => {
    let q = supabase.from("entity_feed").select("id", { count: "exact", head: true }).eq("entity_type", fil).gte("created_at", depuis14);
    q = etat === null ? q.is("recoupement", null) : q.eq("recoupement", etat);
    return (await q).count ?? 0;
  };
  const lignesFils: string[] = [];
  for (const [fil, nom] of [["commune", "Communes"], ["department", "Départements"], ["region", "Régions"], ["party", "Partis"], ["ministry", "Ministères"]]) {
    const [officiel, recoupe, unique, attente] = await Promise.all([compter(fil, "officiel"), compter(fil, "recoupe"), compter(fil, "unique"), compter(fil, null)]);
    const total = officiel + recoupe + unique + attente;
    if (total) lignesFils.push(`| ${nom} | ${total} | ${officiel} | ${recoupe} | ${unique} | ${attente} |`);
  }
  if (lignesFils.length) {
    out.push("### Recoupement des fils d'actualité (14 jours)", "",
      "| Fil | Informations | Source officielle | Recoupées | Un seul média (mention affichée) | Sans conclusion |", "|---|---:|---:|---:|---:|---:|",
      ...lignesFils, "",
      "« Sans conclusion » : informations d'avant le 12 octobre, dont le titre d'origine n'a pas été conservé — on n'y pose jamais la mention.", "");
  }
  return out;
}

async function main() {
  const lignes: string[] = ["# Cycles d'agents — état des lieux", ""];
  const alertes: Item[] = [];

  for (const cycle of ["programmes", "auditions"] as Cycle[]) {
    const items = [...(await lireCycle(cycle)).values()];
    const parEtape = new Map<string, Item[]>();
    for (const i of items) parEtape.set(i.etape, [...(parEtape.get(i.etape) ?? []), i]);
    // Dénominateur : ce qui PEUT être en ligne. Une réunion dont le compte rendu n'est pas
    // encore paru n'est pas un retard de notre chaîne.
    const suivis = items.filter(i => i.etape !== "sans_source" && i.etape !== "ecarte"
      && (cycle !== "auditions" || i.donnees?.ref || i.etape === "a_transcrire"));
    const attendus = items.filter(i => cycle === "auditions" && i.etape === "detecte" && !i.donnees?.ref).length;
    const enLigne = parEtape.get("en_ligne")?.length ?? 0;

    lignes.push(`## ${cycle === "programmes" ? "Programmes des candidats" : "Auditions et réunions de commission (Assemblée et Sénat)"}`, "");
    lignes.push(`**${enLigne} en ligne sur ${suivis.length} suivis** (${suivis.length ? Math.round(100 * enLigne / suivis.length) : 0} %).`, "");
    if (attendus) lignes.push(`${attendus} réunion(s) récente(s) attendent encore la parution de leur compte rendu par l'Assemblée.`, "");
    lignes.push("| Étape | Nombre |", "|---|---:|");
    for (const [e, l] of [...parEtape.entries()].sort((a, b) => b[1].length - a[1].length)) lignes.push(`| ${NOMS[e] ?? e} | ${l.length} |`);
    lignes.push("");

    const bloques = items.filter(i => {
      const delai = DELAIS[cycle][i.etape];
      if (delai === undefined || TERMINALES.has(i.etape)) return false;
      // L'âge se compte depuis la réunion ou la parution, pas depuis la première détection.
      return jours(i.date_objet ?? i.detecte_le) >= delai;
    }).sort((a, b) => (a.date_objet ?? "").localeCompare(b.date_objet ?? ""));
    if (bloques.length) {
      lignes.push(`### ${bloques.length} blocage(s)`, "");
      for (const b of bloques.slice(0, 40)) {
        lignes.push(`- **${b.date_objet ?? "?"}** · ${b.sujet ?? ""} — ${(b.titre ?? b.cle).slice(0, 110)}`
          + `\n  - ${NOMS[b.etape] ?? b.etape}${b.erreur ? ` : ${b.erreur}` : ""}${b.source_url ? ` · ${b.source_url}` : ""}`);
      }
      if (bloques.length > 40) lignes.push(`- … et ${bloques.length - 40} autres.`);
      lignes.push("");
      alertes.push(...bloques.filter(b => !b.alerte_le));
    }

    const prets = parEtape.get("verifie") ?? [];
    if (prets.length) {
      lignes.push("### Brouillons vérifiés, en attente de mise en ligne", "",
        "Publication automatique coupée (variable `PROGRAMMES_PUBLICATION_AUTO` absente) : mode d'observation.", "");
      for (const p of prets) {
        const b = (p.donnees?.brouillon_verifie ?? []) as { theme: string; propositions: string[] }[];
        lignes.push(`- ${p.sujet} — ${p.titre ?? p.cle} : ${b.reduce((n, t) => n + t.propositions.length, 0)} propositions en ${b.length} thèmes`
          + ` (${(p.donnees?.rejets ?? []).length} écartées) · ${p.source_url}`);
      }
      lignes.push("");
    }
    const videos = parEtape.get("a_transcrire") ?? [];
    if (videos.length) lignes.push(`> ${videos.length} réunion(s) sans compte rendu écrit, à transcrire depuis la vidéo`
      + ` (dont ${videos.filter(v => v.donnees?.lien).length} avec le lien vidéo déjà connu).`, "");
  }

  lignes.push(...await rapportBanc());

  const rapport = lignes.join("\n");
  console.log(rapport);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, rapport + "\n");

  if (alertes.length && !SANS_ALERTE) {
    for (const a of alertes) {
      await supabase.from("cycle_items").update({ alerte_le: new Date().toISOString() }).eq("cycle", a.cycle).eq("cle", a.cle);
      console.log(`::error title=Cycle ${a.cycle} bloqué::${a.date_objet ?? ""} ${(a.titre ?? a.cle).slice(0, 120)} — ${a.erreur ?? NOMS[a.etape] ?? a.etape}`);
    }
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
