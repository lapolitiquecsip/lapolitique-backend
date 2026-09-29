// Deux articles de deux journaux sur le MÊME fait, réécrits par l'IA en deux titres
// différents : « Lancement d'un chantier décennal pour le canal de Nantes à Brest » et
// « La Loire-Atlantique lance un chantier décennal sur le canal de Nantes à Brest ».
// L'adresse diffère, donc la déduplication par URL les laissait passer tous les deux.
//
// On compare les MOTS qui portent le sens : minuscules sans accents, mots de quatre
// lettres et plus, réduits à leurs cinq premières lettres (« lance » et « lancement »
// se rejoignent), plus les nombres (sans eux, « RD 61 » et « RD 62 » se confondraient).
// Deux titres partageant au moins la moitié de leurs mots — et au moins trois — racontent
// le même fait.

const VIDES = new Set([
  "pour", "dans", "avec", "sans", "sous", "entre", "vers", "leur", "leurs", "cette", "celle",
  "ceux", "plus", "moins", "apres", "avant", "depuis", "selon", "chez", "tout", "tous", "toute",
  "sont", "etre", "avoir", "fait", "font", "deux", "trois", "nouveau", "nouvelle",
  // Mots d'institution, présents dans la moitié des titres d'un fil local : ils ne
  // disent pas QUEL fait est rapporté.
  "departement", "departemental", "departementale", "conseil", "region", "regional", "regionale",
  "prefecture", "prefet", "commune", "communes", "ville", "mairie", "municipal", "municipale",
  "president", "presidente", "annonce", "lance", "lancement",
]);

const radical = (m: string) => m.slice(0, 5);

export function motsDuTitre(titre: string, ignorer: Set<string> = new Set()): Set<string> {
  const t = (titre || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const out = new Set<string>();
  for (const m of t.split(/[^a-z0-9]+/)) {
    if (/^\d{2,}$/.test(m)) { out.add(m); continue; }
    if (m.length < 4 || VIDES.has(m)) continue;
    const r = radical(m);
    if (!ignorer.has(r)) out.add(r);
  }
  return out;
}

/**
 * `contexte` : le nom du territoire du fil (« Eure-et-Loir »). Ses mots sont
 * retirés de la comparaison — sans cela, « Eure-et-Loir en fête à Val d'Yerre » et
 * « Eure-et-Loir en fête à Senonches », deux fêtes distinctes, passaient pour une seule.
 */
export function quasiDoublon(a: string, b: string, contexte = "", seuil = 0.5): boolean {
  const ignorer = motsDuTitre(contexte);
  const A = motsDuTitre(a, ignorer), B = motsDuTitre(b, ignorer);
  if (!A.size || !B.size) return false;
  // Des nombres différents désignent des faits différents : « état civil de la
  // semaine 32 » n'est pas « semaine 33 », ni la RD 61 la RD 62.
  // Tous les nombres comptent ici, même d'un chiffre : « fermé du 3 au 4 » n'est pas
  // « fermé les 7 et 9 ».
  const nombres = (t: string) => (t.match(/\d+/g) || []);
  const nA = nombres(a), nB = nombres(b);
  if (nA.length && nB.length && !nA.some(n => nB.includes(n))) return false;
  let communs = 0;
  for (const m of A) if (B.has(m)) communs++;
  const union = A.size + B.size - communs;
  return communs >= 3 && communs / union >= seuil;
}
