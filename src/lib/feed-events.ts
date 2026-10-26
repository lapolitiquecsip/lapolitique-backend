// Copie de politique-pour-tous/src/lib/feed-events.ts : les deux dépôts alimentent
// la table content et doivent rapprocher les fiches avec les mêmes règles.

// Regroupement des fiches du fil d'accueil par événement.
//
// La déduplication sur source_url laisse passer le cas le plus courant : trois
// médias couvrent la même nouvelle (« Réélection de Jordan Bardella… ») et le
// fil empile trois cartes qui disent la même chose. On rapproche donc les fiches
// par leur titre (règle quasiDoublon) dans une fenêtre de trois jours,
// et on réunit leurs sources sur une seule carte.
//
// Utilisé à l'affichage (fiches déjà en base) et à l'ingestion
// (contentScrapingService du site, assemblee-pipeline ici), pour qu'une nouvelle fiche sur un événement déjà
// couvert enrichisse l'existante au lieu d'en créer une autre.

import { quasiDoublon } from "./quasi-doublon.js";

export type FicheFil = {
  titre_simplifie?: string | null;
  date_publication?: string | null;
  source_url?: string | null;
  source_name?: string | null;
};

const FENETRE_MS = 72 * 3600 * 1000;

// Les documents parlementaires numérotés (« N° 3394 tome IV – Avis… ») se
// ressemblent tous par le titre mais sont des pièces distinctes : jamais regroupés.
const DOCUMENT_OFFICIEL = /assemblee-nationale\.fr\/(17|dyn)\/|senat\.fr\/(leg|rap|notice-rapport|dossier-legislatif)\//;

export function regroupable(f: FicheFil): boolean {
  return !!f.titre_simplifie && !DOCUMENT_OFFICIEL.test(f.source_url || "");
}

function proches(a: FicheFil, b: FicheFil): boolean {
  const ta = Date.parse(a.date_publication || ""), tb = Date.parse(b.date_publication || "");
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || Math.abs(ta - tb) > FENETRE_MS) return false;
  return memeSujet(a.titre_simplifie || "", b.titre_simplifie || "");
}

/** Deux titres décrivent-ils le même événement ? Règle commune avec le backend
 *  (quasi-doublon) : au moins trois mots porteurs de sens et la moitié en commun,
 *  et pas de nombres contradictoires. */
export const memeSujet = (titreA: string, titreB: string) => quasiDoublon(titreA, titreB);

/** Réunit deux listes « Le Monde, AFP » sans doublon, dans l'ordre d'apparition. */
export function fusionnerSources(...listes: (string | null | undefined)[]): string {
  const vues = new Map<string, string>();
  for (const liste of listes) {
    for (const s of (liste || "").split(",").map(x => x.trim()).filter(Boolean)) {
      const cle = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");
      if (!vues.has(cle)) vues.set(cle, s);
    }
  }
  return [...vues.values()].join(", ");
}

export type Article = { url: string; sources: string };

/**
 * Fil trié du plus récent au plus ancien → une carte par événement. La carte
 * gardée est la plus récente ; elle porte l'union des sources et, dans
 * `articles`, le lien de chaque fiche réunie (la sienne en premier).
 */
export function regrouperParEvenement<T extends FicheFil>(fil: T[]): (T & { articles?: Article[] })[] {
  const sortie: (T & { articles?: Article[] })[] = [];
  const groupes: { tete: T & { articles?: Article[] }; membres: T[] }[] = [];
  for (const fiche of fil) {
    const groupe = regroupable(fiche) ? groupes.find(g => g.membres.some(m => proches(m, fiche))) : undefined;
    if (!groupe) {
      const tete = { ...fiche };
      sortie.push(tete);
      if (regroupable(fiche)) groupes.push({ tete, membres: [fiche] });
      continue;
    }
    groupe.membres.push(fiche);
    groupe.tete.source_name = fusionnerSources(...groupe.membres.map(m => m.source_name));
    groupe.tete.articles = groupe.membres
      .filter(m => m.source_url)
      .map(m => ({ url: m.source_url as string, sources: m.source_name || "Source" }));
  }
  return sortie;
}
