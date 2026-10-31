import { PALETTES, slideIdee, type Slide } from "./gabarits.js";

export type DonneesIdee = {
  rubrique: string;
  accroche: string;
  points: string[];
  source: string;
  palette?: keyof typeof PALETTES;
};

/** Carrousel d'une idée de post : couverture, faits par groupes de deux, source. */
export function carrouselIdee(d: DonneesIdee, dossier: string): Slide[] {
  const pages: string[][] = [];
  for (let i = 0; i < d.points.length; i += 2) pages.push(d.points.slice(i, i + 2));
  return slideIdee(d, pages, dossier);
}
