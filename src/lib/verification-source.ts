// Vérification d'un texte rédigé contre sa source, sans IA.
//
// Question posée : le texte avance-t-il un NOMBRE que sa source ne contient pas ? C'est le
// signe le plus sûr d'un chiffre inventé ou « complété de mémoire » par le rédacteur — le
// banc d'essai du 12 octobre 2026 l'a montré sur le fil de l'accueil (« 46 États membres »
// là où la source ne donnait aucun nombre).
//
// Le même code existe dans le dépôt du site (src/lib/services/verificationSource.ts) : les
// deux dépôts ne partagent pas de bibliothèque, toute correction se reporte de l'un à l'autre.

const sansAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const UNITES: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
};
const MULTIPLES: Record<string, number> = { mille: 1e3, million: 1e6, millions: 1e6, milliard: 1e9, milliards: 1e9 };

/**
 * Les nombres écrits en toutes lettres dans un texte (« soixante-dix-huit » → 78,
 * « douze mille » → 12 000). Un compte rendu parlementaire écrit ses nombres en lettres ;
 * le résumé les écrit en chiffres. Sans cette lecture, le contrôle criait à l'invention
 * devant un chiffre parfaitement sourcé.
 */
export function nombresEnLettres(texte: string): number[] {
  // Les mots, et la ponctuation à part : une virgule sépare deux nombres (« treize en 2023,
  // soixante-dix-huit en 2024 » n'est pas un seul nombre).
  const mots = sansAccent(texte).match(/[a-z]+|[^a-z\s-]/g) ?? [];
  const trouves: number[] = [];
  let total = 0, courant = 0, actif = false, longueur = 0;
  const clore = () => {
    // Un chiffre seul (« un », « six ») est trop banal pour compter comme nombre cité.
    if (actif && (longueur > 1 || total + courant >= 10)) trouves.push(total + courant);
    total = 0; courant = 0; actif = false; longueur = 0;
  };
  for (const m of mots) {
    if (m === "et" && actif) continue;                         // « vingt et un »
    if (m in UNITES) {
      const v = UNITES[m];
      // « quatre-vingt » : le vingt multiplie le quatre qui précède.
      if (v === 20 && courant % 100 === 4) courant = courant - 4 + 80;
      else courant += v;
      actif = true; longueur++;
    } else if (m === "cent" || m === "cents") {
      const centaines = courant % 100;
      courant = courant - centaines + (centaines || 1) * 100;
      actif = true; longueur++;
    } else if (m in MULTIPLES) {
      total += (courant || 1) * MULTIPLES[m];
      courant = 0; actif = true; longueur++;
    } else clore();
  }
  clore();
  return trouves;
}

const MOIS = "janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre";

/**
 * Les nombres du texte que la source ne porte pas.
 *
 * Ne sont pas contrôlés : les années, les jours d'une date (« le 12 octobre » — la date vient
 * souvent de la parution, pas du corps de la source), les heures et les chiffres isolés.
 */
export function chiffresAbsents(texte: string, source: string): string[] {
  const srcChiffres = source.replace(/[\s.,  ]/g, "") + " " + nombresEnLettres(source).join(" ");
  const absents = new Set<string>();
  const t = sansAccent(texte);
  for (const m of t.matchAll(/\d{1,3}(?:[   ]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g)) {
    const brut = m[0].replace(/[\s.,  ]/g, "");
    if (brut.length < 2 || /^(19|20)\d\d$/.test(brut)) continue;
    const suite = t.slice(m.index! + m[0].length, m.index! + m[0].length + 14);
    if (new RegExp(`^(er)?\\s+(${MOIS})\\b`).test(suite) || /^\s?h(\d|\b)/.test(suite)) continue;
    if (!srcChiffres.includes(brut)) absents.add(m[0].trim());
  }
  return [...absents];
}

/**
 * Le texte, débarrassé des phrases qui avancent un nombre absent de la source.
 *
 * On retire la phrase entière plutôt que le seul chiffre : une phrase construite autour d'un
 * nombre inventé (« dans les 46 États membres ») ne dit plus rien de sûr une fois le nombre ôté.
 */
export function retirerPhrasesNonSourcees(texte: string, source: string): { texte: string; retirees: string[] } {
  const phrases = (texte || "").split(/(?<=[.!?…])\s+/).filter(Boolean);
  const gardees: string[] = [], retirees: string[] = [];
  for (const p of phrases) (chiffresAbsents(p, source).length ? retirees : gardees).push(p);
  return { texte: gardees.join(" "), retirees };
}
