/**
 * Médias jamais repris comme source sur le site (décision éditoriale de l'éditeur, 08/11/2026) :
 * aucun article, aucune citation, aucune « preuve » ne doit venir d'eux, quel que soit le fil
 * (candidats, partis, communes, controverses, exécutif, recoupement…).
 *
 * Même liste côté site : politique-pour-tous/src/lib/medias-bannis.ts — À TENIR IDENTIQUES.
 */
export const DOMAINES_BANNIS = ["valeursactuelles.com", "frontieresmedia.fr", "frontieres.media"];
const NOMS_BANNIS = /^\s*(valeurs\s+actuelles|fronti[eè]res(\s+m[eé]dia)?)\s*$/i;
const DOMAINE = new RegExp(`(^|\\.)(${DOMAINES_BANNIS.map(d => d.replace(/\./g, "\\.")).join("|")})$`, "i");

/** Vrai si l'adresse ou le nom de média désigne un média banni. */
export function mediaBanni(...valeurs: (string | null | undefined)[]): boolean {
  for (const v of valeurs) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (NOMS_BANNIS.test(s)) return true;
    try { if (DOMAINE.test(new URL(s).hostname)) return true; } catch { /* pas une adresse */ }
    if (/valeursactuelles\.com|frontieresmedia\.fr|frontieres\.media/i.test(s)) return true;
  }
  return false;
}
