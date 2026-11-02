/**
 * Une biographie contredite par les sources officielles, corrigée sans IA.
 *
 * Les bios sont rédigées une fois et ne bougent plus : « vice-président du Sénat depuis 2023 » y
 * reste après le renouvellement du Bureau. On ne repère que des fonctions officiellement vérifiables,
 * et seulement quand le texte les présente comme actuelles : « de 2023 à 2024 » est une information
 * juste, à laquelle on ne touche pas. Mieux vaut laisser passer un doute (signalé à l'administrateur)
 * que retirer une phrase vraie.
 */
export type FonctionVue = { categorie: string; qualite: string | null; libelle: string };
export type Correction = { champ: "summary" | "parcours"; role: string; avant: string; apres: string | null };

const plat = (t: string) => (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’]/g, "'").replace(/·e?s?/g, "");
const a = (f: FonctionVue[], categorie: string, re: RegExp) => f.some(x => x.categorie === categorie && re.test(plat(x.qualite ?? x.libelle)));
const LOCAL = /conseil|metropole|municipal|regional|departement|agglomeration|mairie|communaute|amitie|etudes|travail/;
// « Groupe » sans plus de précision désigne aussi des groupes d'études (« Groupe Santé Environnement ») :
// seuls les vrais groupes politiques, nommés, sont vérifiables.
const GROUPE_POLITIQUE = /(?<!vice[- ])\bpresidente? du groupe (parlementaire|politique|socialiste|ecologiste|communiste|centriste|les |la |l'|lr\b|ump\b|rn\b|lfi\b|liot\b|libertes|horizons|ensemble|renaissance|rassemblement|droite|gauche|democrate|union|patriotes|identite|conservateurs|renew|independants|ser\b|rdse\b|rdpi\b|crce\b|modem\b)/;

type Regle = { role: string; motif: RegExp; officiel: (f: FonctionVue[]) => boolean; sauf?: RegExp };
const REGLES: Regle[] = [
  { role: "Vice-présidence de la chambre", motif: /vice[- ]presidente? (du senat|de l'assemblee nationale)/, officiel: f => a(f, "bureau", /vice/) },
  { role: "Présidence de la chambre", motif: /(?<!vice[- ])\bpresidente? (du senat|de l'assemblee nationale)/, officiel: f => a(f, "bureau", /^presidente?\b/) },
  { role: "Questure", motif: /questeure? (du senat|de l'assemblee nationale)/, officiel: f => a(f, "bureau", /questeur/) },
  { role: "Secrétariat de la chambre", motif: /secretaire (du senat|de l'assemblee nationale)/, officiel: f => a(f, "bureau", /secretaire/) },
  { role: "Vice-présidence du Parlement européen", motif: /vice[- ]presidente? du parlement europeen/, officiel: f => a(f, "bureau", /vice/) },
  { role: "Présidence du groupe", motif: GROUPE_POLITIQUE, sauf: LOCAL, officiel: f => a(f, "groupe", /^(co)?presidente?\b/) },
  { role: "Présidence de commission", motif: /(?<!vice[- ])\bpresidente? de la commission (des|de la|de l'|du)\b/, sauf: LOCAL, officiel: f => f.some(x => x.categorie === "commission" && /^presidente?\b/.test(plat(x.qualite ?? ""))) },
];

const FERME = /\b(ancien|ancienne|ex-|fut|a ete|avait|jusqu|quitte|demission|de (19|20)\d\d a (19|20)\d\d|entre (19|20)\d\d|en (19|20)\d\d|(19|20)\d\d\s*[-–]\s*(19|20)\d\d)/;
const RECIT = /\b(designe|designee|elu|elue|nomme|nommee|devient|devenue|puis)\b/;

/** Le morceau présente-t-il la fonction comme toujours exercée ? */
function auPresent(morceau: string, phrase: string): boolean {
  if (FERME.test(morceau) || RECIT.test(morceau)) return false;
  if (/\b(depuis|actuel|actuellement|en fonction)\b/.test(morceau)) return true;
  return /\b(est|occupe|exerce)\b/.test(phrase) && !FERME.test(phrase) && !RECIT.test(phrase);
}

/** Une ligne de parcours « ouverte » : (depuis 2023), (4 octobre 2023-), 2024- : … */
const ligneOuverte = (l: string) => /\bdepuis\b/.test(l) || /\d\s*-\s*\)/.test(l) || /\d\s*-\s*:/.test(l);

/** Ferme une ligne de parcours : la fonction a existé, elle n'a plus cours ; sa date de fin reste inconnue. */
function fermerLigne(l: string): string {
  const t = l
    .replace(/\bdepuis le\b/gi, "à partir du").replace(/\bdepuis\s+(?=[aeiouàâéèêîïôûh])/gi, "à partir d'").replace(/\bdepuis\b/gi, "à partir de")
    .replace(/\((\d{1,2}(?:er)?\s+\S+\s+\d{4})\s*-\s*\)/, "(à partir du $1)")
    .replace(/\(((?:\S+\s+)?\d{4})\s*-\s*\)/, (_, d) => `(à partir ${/^[aeiouàâéèêîïôûh]/i.test(d) ? "d'" : "de "}${d})`)
    .replace(/^(\d{4})\s*-\s*:\s*/, "$1 : ");
  return `${t.trimEnd()} (fonction terminée)`;
}

/**
 * Retire d'une phrase la fonction démentie, du séparateur qui la précède à la virgule qui la suit ;
 * pas jusqu'au prochain « et », qui peut appartenir à son nom (« Solidarité et Territoires »).
 * null si la phrase entière n'est que cela ; ok = false si la fonction porte le sujet de la phrase.
 */
function retirerMorceau(phrase: string, motif: RegExp): { texte: string | null; ok: boolean } {
  const m = motif.exec(plat(phrase));
  if (!m) return { texte: phrase, ok: false };
  const debut = longueurOriginale(phrase, m.index);
  const sansPoint = phrase.replace(/\.\s*$/, "");
  const avant = sansPoint.slice(0, debut);
  const coupe = Math.max(avant.lastIndexOf(", "), avant.lastIndexOf(" et "), avant.lastIndexOf("; "));
  const finVirgule = sansPoint.indexOf(", ", debut);
  const fin = finVirgule < 0 ? sansPoint.length : finVirgule;
  if (coupe < 0) {
    // Pas de séparateur avant : « Il est vice-président du Sénat depuis 2023. » La phrase n'est que cela, ou le sujet y est.
    return fin === sansPoint.length ? { texte: null, ok: true } : { texte: phrase, ok: false };
  }
  const reste = `${sansPoint.slice(0, coupe)}${sansPoint.slice(fin)}`.trim();
  return { texte: `${reste}.`, ok: true };
}

/** La position dans le texte d'origine d'un index du texte aplati (les « ·e » retirés décalent le compte). */
function longueurOriginale(phrase: string, index: number): number {
  for (let i = 0; i <= phrase.length; i++) if (plat(phrase.slice(0, i)).length >= index) return i;
  return phrase.length;
}

export function corrigerBio(bio: any, fonctions: FonctionVue[]): { bio: any; corrections: Correction[]; aRevoir: string[] } {
  const corrections: Correction[] = [], aRevoir: string[] = [];
  if (!bio || typeof bio !== "object") return { bio, corrections, aRevoir };
  const neuve = { ...bio };

  if (Array.isArray(bio.parcours)) {
    neuve.parcours = bio.parcours.map((ligne: any) => {
      if (typeof ligne !== "string") return ligne;
      const l = plat(ligne);
      for (const r of REGLES) {
        if (!r.motif.test(l) || (r.sauf && r.sauf.test(l)) || r.officiel(fonctions) || !ligneOuverte(l)) continue;
        const apres = fermerLigne(ligne);
        corrections.push({ champ: "parcours", role: r.role, avant: ligne, apres });
        return apres;
      }
      return ligne;
    });
  }

  if (typeof bio.summary === "string") {
    const phrases = bio.summary.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/);
    const gardees: string[] = [];
    for (const phrase of phrases) {
      let courante: string | null = phrase;
      for (const r of REGLES) {
        if (!courante) break;
        const pl = plat(courante);
        if (!r.motif.test(pl) || (r.sauf && r.sauf.test(pl)) || r.officiel(fonctions)) continue;
        const morceau = pl.replace(/\.\s*$/, "").split(/,\s+|\s+et\s+|;\s+/).find(m => r.motif.test(m)) ?? pl;
        if (!auPresent(morceau, pl)) continue;
        const { texte, ok } = retirerMorceau(courante, r.motif);
        if (!ok) { aRevoir.push(courante); break; }
        corrections.push({ champ: "summary", role: r.role, avant: courante, apres: texte });
        courante = texte;
      }
      if (courante) gardees.push(courante);
    }
    neuve.summary = gardees.join(" ");
  }
  return { bio: neuve, corrections, aRevoir };
}
