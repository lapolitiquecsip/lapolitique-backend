/**
 * Recherche des mots-clés d'une veille dans un texte (amendement, compte rendu, décret…).
 *
 * Sans accents ni majuscules, en mot entier (« loyer » ne trouve pas « employeur »), pluriel
 * compris (« éolienne » trouve « éoliennes »). Une expression de plusieurs mots est cherchée
 * telle quelle. Une exclusion présente dans le texte l'écarte entièrement.
 * Renvoie le mot trouvé et l'extrait EXACT du texte qui le contient, pour que l'alerte cite sa source.
 *
 * Même logique côté site (supabase/functions/veille-mots-cles), pour l'aperçu avant enregistrement.
 */

/** Caractère par caractère, pour garder les positions du texte d'origine (l'extrait est découpé dedans). */
const platCar = (c: string) => (c.normalize("NFD")[0] || c).toLowerCase().replace(/[’`]/, "'");

export const sansBalises = (s: string | null | undefined) =>
  String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

function motif(mot: string): RegExp | null {
  const m = Array.from(mot.trim()).map(platCar).join("").replace(/\s+/g, " ");
  if (m.length < 2) return null;
  const echappe = m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s'-]+");
  return new RegExp(`(^|[^a-z0-9])(${echappe}(?:s|x)?)(?=[^a-z0-9]|$)`);
}

export function trouve(texte: string, motsCles: string[], exclusions: string[] = []): { mot: string; extrait: string } | null {
  const car = Array.from(texte);
  const plat = car.map(platCar).join("");
  for (const ex of exclusions) { const r = motif(ex); if (r && r.test(plat)) return null; }
  for (const mot of motsCles) {
    const r = motif(mot); if (!r) continue;
    const m = r.exec(plat); if (!m) continue;
    const debut = m.index + m[1].length, fin = debut + m[2].length;
    // Une phrase autour : 110 caractères de chaque côté, coupés aux mots.
    let a = Math.max(0, debut - 110), b = Math.min(car.length, fin + 110);
    while (a > 0 && car[a - 1] !== " ") a--;
    while (b < car.length && car[b] !== " ") b++;
    const extrait = `${a > 0 ? "…" : ""}${car.slice(a, b).join("").trim()}${b < car.length ? "…" : ""}`;
    return { mot, extrait };
  }
  return null;
}
