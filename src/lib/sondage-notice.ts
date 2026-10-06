/**
 * L'acheteur d'un sondage, lu dans sa notice officielle (Commission des sondages).
 * Loi n° 77-808 du 19 juillet 1977, art. 2 : toute publication d'un sondage électoral
 * nomme l'organisme qui l'a réalisé et son acheteur. Chaque institut a sa mise en page :
 *  - intitulé puis valeur : « Commanditaires du sondage » / « Le HuffPost » (YouGov) ;
 *  - en-tête : « NOTICE TECHNIQUE : Ifop-Fiducial pour LCI, Le Figaro et Sud Radio » ;
 *  - texte collé par l'extraction : « EtudeCluster17réaliséepourPoliticoauprèsd'un… ».
 */
export function acheteurDe(texte: string): string {
  const plat = texte.replace(/\s+/g, " ");
  // « «Toluna Harris Interactive pour M6 et RTL» » → « M6 et RTL » : guillemets et institut retirés.
  const propre = (x: string) => x.replace(/[«»"“”]/g, "").replace(/^.{0,60}?\bpour\s+/i, "")
    .replace(/\s*[–—]\s*/g, ", ").replace(/^[:\s,-]+/, "").replace(/[\s,.;:-]+$/, "").trim().slice(0, 120);
  // Mots collés par l'extraction (« TolunaHarrisInteractivepourM6etRTL ») : illisible, on renvoie à la notice.
  const valable = (x: string) => x.length >= 2 && !(x.length > 14 && !/\s/.test(x))
    && !/^(?:(?:la|le|les|un|une|des|ce|cette|l')\s*[a-zé]|(?:s|du|de)\b)/.test(x) && !/^\d/.test(x);

  // 1. Le champ de l'article 2 de la notice, présent chez la plupart des instituts.
  const champ = plat.match(/(?:commanditaire(?:\(s\)|s)?|acheteurs?|nom (?:et qualit[ée] )?de l.acheteur)\s*(?:du sondage|de l.[ée]tude)?\s*:?\s*(.{2,140}?)(?=\s*(?:▪|•|Nom et qualit|Nombre de personnes|Existence d|Gratification|Dates? |Organisme|Objet|[ÉE]chantillon|M[ée]thode|Mode d|Taille|Article)|$)/i);
  if (champ && valable(propre(champ[1]))) return propre(champ[1]);

  // 2. L'en-tête « NOTICE TECHNIQUE : Ifop-Fiducial pour LCI, Le Figaro et Sud Radio ».
  for (const l of texte.split(/\n/).map(x => x.replace(/\s+/g, " ").trim())) {
    const m = l.match(/(?:notice(?: technique)?|r[ée]alis[ée]e? par|sondage|enqu[êe]te|[ée]tude)\b.{0,60}?\bpour\s+(?:le compte de\s+)?(.{2,100})$/i);
    if (m) {
      const x = propre(m[1].split(/\s+(?:–|-|aupr[èe]s|du \d|entre le|r[ée]alis)\s*/i)[0]);
      if (valable(x)) return x;
    }
  }

  // 3. Texte collé par l'extraction : « Cluster17réaliséepourPoliticoauprèsd'un… ».
  const colle = plat.match(/r[ée]alis[ée]e?\s*pour\s*(?:le\s*compte\s*de\s*)?([A-Z].{1,60}?)\s*aupr[èe]s/);
  return colle && valable(propre(colle[1])) ? propre(colle[1]) : "";
}

/**
 * Loi n° 77-808 du 19 juillet 1977, art. 11 : ni publication, ni diffusion, ni commentaire
 * d'un sondage électoral la veille et le jour de chaque tour. L'outre-mer votant dès le
 * samedi, on se tait du vendredi 0 h au dimanche 20 h (Paris). Mêmes dates que le site
 * (src/lib/dynamiques.ts) ; à confirmer par le décret de convocation (début 2027).
 */
export const TOURS_PRESIDENTIELLE = ["2027-04-18", "2027-05-02"];
export function silenceSondages(maintenant = new Date()): string | null {
  for (const dimanche of TOURS_PRESIDENTIELLE) {
    const vendredi = new Date(new Date(dimanche + "T12:00:00Z").getTime() - 2 * 864e5).toISOString().slice(0, 10);
    if (maintenant >= new Date(vendredi + "T00:00:00+02:00") && maintenant < new Date(dimanche + "T20:00:00+02:00")) return dimanche;
  }
  return null;
}
