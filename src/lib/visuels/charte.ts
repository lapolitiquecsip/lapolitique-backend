/**
 * Charte Instagram v3 de Rose (graphiste) — 26/11/2026.
 *
 * Source : la consigne de design écrite avec ChatGPT par Hippolyte (docs/consigne-design-instagram-
 * chatgpt.md), vérifiée et arbitrée le 26/11 :
 * - 4 PALETTES EN ROTATION d'un post à l'autre (rose, cobalt, ciel, bordeaux), jamais attribuées à un
 *   candidat ou à un parti ; un carrousel garde la même palette de bout en bout ;
 * - le LOGO OFFICIEL (temple sans flèche, « LOGO LPCS UNE BONNE FOIS POUR TOUTE »), recoloré selon
 *   la palette, proportions gardées ;
 * - titres Anton (étroit, capitales, accents gardés), texte League Spartan ;
 * - un seul cartouche d'accent par visuel ; fond à grain très fin ; marges de 70 px ; texte de 32 à
 *   40 px sur les slides intérieures (jamais sous 30 px : au-delà, la slide est coupée en deux) ;
 * - portraits = VRAIES photos détourées en noir et blanc (detourer.py), jamais générées par une IA ;
 *   objets noir et blanc de la bibliothèque (images ChatGPT d'Hippolyte), réduits ou retirés s'ils
 *   gênent un texte (rendu.ts) ;
 * - la famille « actu » (bleu électrique, menthe, papier déchiré), absente de la consigne, est gardée.
 * Gabarit A : carrousel « Programme [Prénom Nom] ». Gabarit B : affiche « Les programmes en détail »
 * (9:16, et 4:5 pour le fil). Export JPEG (seul format accepté par l'API de publication d'Instagram).
 *
 * Les textes sont échappés ; rien n'est inventé ici : une donnée absente retire son bloc.
 */

export const FORMAT = { carre: { largeur: 1080, hauteur: 1350 }, story: { largeur: 1080, hauteur: 1920 } };

export type Page = { html: string; nom: string; format: keyof typeof FORMAT };

/** Les 4 palettes de la consigne (fond, texte, cartouche/accent, lettres sur l'accent). */
export const PALETTES = {
  rose: { fond: "#EDBDC9", encre: "#45162A", accent: "#561C35", surAccent: "#FFF9F4", sombre: false },
  cobalt: { fond: "linear-gradient(165deg, #1738A9 0%, #092283 100%)", encre: "#F7F9FF", accent: "#BDEDFC", surAccent: "#09235F", sombre: true },
  ciel: { fond: "#B1DBF4", encre: "#0B2A42", accent: "#0B2A42", surAccent: "#B1DBF4", sombre: false },
  bordeaux: { fond: "#670828", encre: "#F8F4D9", accent: "#F8F4D9", surAccent: "#670828", sombre: true },
} as const;
export type NomPalette = keyof typeof PALETTES;
export const ROTATION: NomPalette[] = ["rose", "cobalt", "ciel", "bordeaux"];
/** La palette du n-ième post (rotation) : jamais liée à la personne ou au parti. */
export const paletteDuPost = (n: number): NomPalette => ROTATION[((n % 4) + 4) % 4];

const ACTU = { fond: "#1E2BF0", encre: "#FFFFFF", accent: "#8FF0CF", noir: "#0B0B12" };

export const echapper = (t: string) =>
  String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "’")
    .replace(/ ([%?!:;»])/g, " $1").replace(/« /g, "« ").replace(/(\d) (\d{3})\b/g, "$1 $2");

/** Le logo officiel (temple sans flèche, géométrie de assets/visuels/logo.svg), recoloré. */
export const logo = (pastille: string, temple: string, classe = "logo") => `
<svg class="${classe}" viewBox="0 0 512 512"><rect width="512" height="512" rx="115" fill="${pastille}"/>
<path d="M 256 150 L 372 232 L 140 232 Z" fill="none" stroke="${temple}" stroke-width="26" stroke-linejoin="round"/>
<g fill="${temple}"><rect x="165" y="262" width="26" height="118" rx="13"/><rect x="217" y="262" width="26" height="118" rx="13"/>
<rect x="269" y="262" width="26" height="118" rx="13"/><rect x="321" y="262" width="26" height="118" rx="13"/></g>
<rect x="120" y="392" width="272" height="28" rx="14" fill="${temple}"/></svg>`;

/** Le logo dans ses couleurs d'origine (dégradé rose), pour la famille actu. */
const logoOrigine = (classe = "logo") => `
<svg class="${classe}" viewBox="0 0 512 512"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F2215E"/><stop offset=".5" stop-color="#DD239F"/><stop offset="1" stop-color="#BA14D0"/></linearGradient></defs>
<rect width="512" height="512" rx="115" fill="url(#lg)"/>
<path d="M 256 150 L 372 232 L 140 232 Z" fill="none" stroke="#fff" stroke-width="26" stroke-linejoin="round"/>
<g fill="#fff"><rect x="165" y="262" width="26" height="118" rx="13"/><rect x="217" y="262" width="26" height="118" rx="13"/>
<rect x="269" y="262" width="26" height="118" rx="13"/><rect x="321" y="262" width="26" height="118" rx="13"/></g>
<rect x="120" y="392" width="272" height="28" rx="14" fill="#fff"/></svg>`;

/** Trois petits traits ( \ | / ) de la couleur d'accent, qui ponctuent un objet. */
const eclat = (couleur: string, classe = "eclat") =>
  `<svg class="${classe}" viewBox="0 0 120 80" fill="none" stroke="${couleur}" stroke-width="9" stroke-linecap="round"><path d="M20 62 L8 40"/><path d="M58 52 L56 14"/><path d="M92 60 L112 36"/></svg>`;

const FLECHE = `<svg class="fleche" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16M14 6l6 6-6 6"/></svg>`;

/** Bord de papier déchiré (famille actu). Inclus une fois par page. */
const FILTRES = `<svg width="0" height="0" style="position:absolute"><defs>
<filter id="dechire" x="-5%" y="-20%" width="110%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.055 0.09" numOctaves="3" seed="7"/><feDisplacementMap in="SourceGraphic" scale="14"/></filter>
<filter id="net"><feComponentTransfer><feFuncA type="linear" slope="1.35" intercept="-0.3"/></feComponentTransfer></filter>
<filter id="dechire2" x="-5%" y="-20%" width="110%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.07 0.05" numOctaves="3" seed="3"/><feDisplacementMap in="SourceGraphic" scale="12"/></filter>
</defs></svg>`;

export const CSS_CHARTE = (dossier: string) => `
@font-face { font-family: Anton; src: url("${dossier}/anton-latin-400-normal.woff2"); }
@font-face { font-family: AntonExt; src: url("${dossier}/anton-latin-ext-400-normal.woff2"); }
${[500, 600, 700, 800].map(p => `@font-face { font-family: Spartan; font-weight: ${p}; src: url("${dossier}/league-spartan-latin-${p}-normal.woff2"); }
@font-face { font-family: SpartanExt; font-weight: ${p}; src: url("${dossier}/league-spartan-latin-ext-${p}-normal.woff2"); }`).join("\n")}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #000; }
.slide { position: relative; overflow: hidden; display: flex; flex-direction: column; padding: 60px 70px 54px;
  font-family: Spartan, SpartanExt, sans-serif; color: var(--encre); background: var(--fond); }
.slide.carre { width: 1080px; height: 1350px; }
.slide.story { width: 1080px; height: 1920px; padding: 130px 70px 120px; }
/* Grain très fin, sur fond clair comme sombre. */
.slide::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .16; mix-blend-mode: soft-light; z-index: 5;
  background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' stitchTiles='stitch'/></filter><rect width='260' height='260' filter='url(%23g)'/></svg>"); }
.A { font-family: Anton, AntonExt, sans-serif; font-weight: 400; text-transform: uppercase; line-height: 1.08; letter-spacing: .003em; }
.tete { display: flex; align-items: center; gap: 24px; position: relative; z-index: 3; flex: none; }
.logo { width: 88px; height: 88px; flex: none; }
.rub { font-size: 48px; }
.page { margin-left: auto; font-weight: 700; font-size: 27px; letter-spacing: .04em; }
.corps { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; position: relative; z-index: 3; }
.attribution { font-weight: 700; font-size: 27px; text-transform: uppercase; letter-spacing: .03em; margin-top: 38px; }
.titre { font-size: 150px; margin-top: 14px; }
.cartouche { display: inline-block; background: var(--accent); color: var(--sur-accent); padding: 4px 20px 0; margin-left: -8px; }
.cartouche.arrondi { border-radius: 18px; padding: 6px 26px 2px; white-space: nowrap; }
.trait { width: 136px; height: 13px; background: var(--accent); margin: 34px 0 8px; flex: none; }
.accroche { font-weight: 700; font-size: 40px; line-height: 1.22; }
.bandeau-serie { display: inline-flex; align-items: center; gap: 16px; align-self: flex-start; background: var(--accent); color: var(--sur-accent); font-weight: 700; font-size: 34px; padding: 18px 26px 14px; position: relative; z-index: 4; }
.fleche { width: 36px; height: 36px; flex: none; }
.mesures { display: flex; flex-direction: column; margin-top: 14px; }
.mesure { display: grid; grid-template-columns: 70px 1fr; column-gap: 26px; padding: 24px 0; border-top: 2px solid color-mix(in srgb, var(--encre) 40%, transparent); }
.mesure:first-child { border-top: 0; }
.mesure .n { align-self: start; margin-top: 8px; background: var(--accent); color: var(--sur-accent); font-weight: 800; font-size: 28px; text-align: center; padding: 8px 0 4px; }
.mesure .t { font-size: 62px; }
.mesure .d { grid-column: 2; font-weight: 600; font-size: 36px; line-height: 1.22; margin-top: 8px; }
.pied { display: flex; align-items: flex-end; justify-content: space-between; gap: 30px; margin-top: auto; padding-top: 22px; position: relative; z-index: 3; flex: none; }
.pied .site { font-weight: 800; font-size: 31px; }
.pied .quoi { font-weight: 700; font-size: 21px; text-transform: uppercase; letter-spacing: .04em; margin-top: 8px; }
.source { font-weight: 700; font-size: 21px; text-transform: uppercase; letter-spacing: .03em; text-align: right; max-width: 50%; }
.credit { position: absolute; z-index: 4; font-weight: 500; font-size: 15px; color: #222; background: rgba(255,255,255,.62); padding: 3px 8px 1px; }
.portrait { position: absolute; z-index: 2; right: 0; bottom: 0; width: 620px; height: 900px; object-fit: contain; object-position: right bottom; }
/* url(#net) efface les pixels presque transparents que laissent les images générées (halo carré). */
.objet { position: absolute; z-index: 2; right: 60px; bottom: 120px; width: 320px;
  filter: url(#net) drop-shadow(4px 0 0 #fff) drop-shadow(-4px 0 0 #fff) drop-shadow(0 4px 0 #fff) drop-shadow(0 -4px 0 #fff); }
.eclat { position: absolute; z-index: 3; width: 96px; }
.eclat-objet { right: 255px; bottom: 445px; }
/* — dernière slide — */
.captures { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 34px; flex: 1 1 auto; min-height: 0; }
.capture { border: 6px solid var(--accent); background: #fff; overflow: hidden; min-height: 0; border-radius: 10px; }
.capture.grande { grid-column: 1 / -1; }
.capture img { width: 100%; display: block; }
.bandeau { margin-top: 34px; display: flex; align-items: center; gap: 18px; background: var(--accent); color: var(--sur-accent); font-weight: 800; font-size: 38px; padding: 22px 28px 18px; justify-content: center; flex: none; }
/* — affiche « Les programmes en détail » — */
.marque { display: flex; align-items: center; gap: 24px; }
.marque .nom { font-size: 64px; line-height: .98; }
.serie { font-weight: 700; font-size: 32px; letter-spacing: .2em; text-transform: uppercase; margin-top: 54px; }
.question { font-size: 168px; line-height: 1.04; margin-top: 20px; }
.contexte { font-weight: 700; font-size: 32px; letter-spacing: .12em; text-transform: uppercase; margin-top: 30px; }
.site-bas { position: absolute; left: 70px; bottom: 60px; z-index: 4; font-weight: 800; font-size: 38px; background: rgba(255,255,255,.9); color: #111; padding: 8px 16px 4px; border-radius: 8px; }
/* — famille actu — */
.actu { color: #fff; }
.marque-actu { display: flex; align-items: center; gap: 22px; }
.marque-actu .sep { width: 4px; height: 88px; background: #fff; border-radius: 2px; }
.marque-actu .nom { font-size: 52px; line-height: .98; }
.dechire { position: relative; display: inline-block; align-self: flex-start; color: ${ACTU.noir}; padding: 8px 26px 4px; margin: 6px 0; }
.dechire::before { content: ""; position: absolute; inset: 0; background: var(--fond-bande, #fff); filter: url(#dechire); z-index: -1; }
.dechire.noir { --fond-bande: ${ACTU.noir}; color: #fff; }
.dechire.menthe { --fond-bande: ${ACTU.accent}; color: ${ACTU.noir}; }
.dechire.n2::before { filter: url(#dechire2); }
.etiq { font-size: 64px; }
.gros { font-size: 136px; }
.moyen { font-size: 64px; }
.chiffre { display: flex; align-items: center; gap: 34px; margin-top: 26px; }
.chiffre .v { font-size: 250px; padding: 10px 34px 0; flex: none; }
.chiffre.compact { margin-top: 18px; }
.chiffre.compact .v { font-size: 120px; min-width: 150px; text-align: center; padding: 6px 22px 0; }
.chiffre.compact .l { font-size: 46px; }
.chiffre .l { font-weight: 700; font-size: 50px; line-height: 1.12; }
.para { font-weight: 700; font-size: 36px; line-height: 1.25; margin-top: 26px; max-width: 800px; }
.sous { font-weight: 800; font-size: 72px; margin-top: 4px; align-self: center; }
.src-actu { font-weight: 500; font-size: 22px; max-width: 46%; position: relative; z-index: 4; }
.src-actu b { font-weight: 800; }
.page-actu { position: absolute; right: 60px; bottom: 50px; z-index: 4; font-size: 34px; font-weight: 800; }
.actu .objet { bottom: 110px; width: 360px; }
.actu .eclat-objet { right: 300px; bottom: 460px; }
.actu .eclat-logo { position: absolute; left: 68px; top: -46px; width: 52px; }
.actu .capture { border-color: #fff; }
.actu .bandeau { background: ${ACTU.accent}; color: ${ACTU.noir}; }
`;

const cadre = (p: NomPalette, format: keyof typeof FORMAT, contenu: string, classes = "") => {
  const c = PALETTES[p];
  return `${FILTRES}<section class="slide ${format} pal-${p} ${classes}" style="--fond:${c.fond};--encre:${c.encre};--accent:${c.accent};--sur-accent:${c.surAccent}">${contenu}</section>`;
};

const cadreActu = (contenu: string) =>
  `${FILTRES}<section class="slide carre actu" style="--fond:${ACTU.fond};--encre:${ACTU.encre};--accent:${ACTU.accent};--sur-accent:${ACTU.noir}">${contenu}</section>`;

/**
 * La bibliothèque d'objets noir et blanc (images ChatGPT d'Hippolyte, storage publications/objets et
 * assets/visuels/objets). L'ordre compte : « sécurité sociale » est de la santé avant la sécurité.
 */
const OBJETS: [RegExp, string][] = [
  [/sécurité sociale|santé|hôpita|médec|soins?\b|maladie|handicap|dépendance/i, "sante"],
  [/retraite|pension/i, "retraites"],
  [/défense|armée|militaire|otan|guerre|soldat|dissuasion/i, "defense"],
  [/école|éducation|enseign|élève|universit|jeunesse|étudiant|savoir/i, "ecole"],
  [/impôt|fiscal|taxe|budget|dette|déficit|finances publiques|cotisation/i, "fiscalite"],
  [/justice|tribunal|juge|pénal|prison|droit\b/i, "justice"],
  [/sécurité|police|gendarm|délinqu|crime|terroris|narcotrafic/i, "securite"],
  [/logement|loyer|locat|immobili|passoire|hlm/i, "logement"],
  [/agricult|paysan|éleveur|alimentation|ruralit/i, "agriculture"],
  [/énergie|nucléaire|électricit|éolien|carburant|renouvelable/i, "energie"],
  [/europ|bruxelles|\bue\b/i, "europe"],
  [/numérique|intelligence artificielle|\bia\b|internet|technolog|innovation|recherche/i, "numerique"],
  [/travail|emploi|chômage|salaire|entreprise|smic|industri/i, "travail"],
  [/immigr|migra|frontière|asile|nationalit/i, "immigration"],
  [/écolog|climat|environnement|biodiversit|\beau\b|communs/i, "ecologie"],
  [/pouvoir d.achat|prix|inflation|consomm/i, "pouvoir-achat"],
  [/international|diplomat|monde|étrangère|afrique|chine|russie|ukraine/i, "international"],
  [/assemblée|député|hémicycle|parlement|amendement/i, "assemblee"],
  [/démocrat|référendum|élection|scrutin|citoyen|vote/i, "democratie"],
];

/** Le nom de l'objet qui illustre un texte ; à défaut, « institutions » (les colonnes). */
export const nomObjet = (texte: string) => (OBJETS.find(([r]) => r.test(texte)) ?? [null, "institutions"])[1];
export const objetPour = (texte: string, dossier: string) => `${dossier}/objets/${nomObjet(texte)}.png`;

const pagination = (i: number, n: number) => `${String(i).padStart(2, "0")} / ${String(n).padStart(2, "0")}`;

const coupeNom = (nom: string) => {
  const m = nom.split(" ");
  // « Dominique | de Villepin », « Jean-Luc | Mélenchon », « Marine | Le Pen » : la particule reste avec le nom.
  const i = m.findIndex((x, k) => k > 0 && (/^(de|du|des|le|la|d’|d')$/i.test(x) || k === m.length - 1));
  return [m.slice(0, i).join(" "), m.slice(i).join(" ")];
};

// ─── Gabarit A : carrousel « Programme [Prénom Nom] » ─────────────────────────

export type Mesure = { titre: string; detail: string };
export type DonneesProgramme = {
  candidat: string;                       // « Dominique de Villepin »
  slug: string;
  palette: NomPalette;
  rubrique?: string;                      // « Présidentielles 2027 »
  portrait: string;                       // URL du PNG détouré noir et blanc
  creditPhoto?: string;
  themes: { titre: string; mesures: Mesure[]; source: string; objet?: string }[];
  captures?: string[];                    // [fiche, programme, parcours] : vraies captures du site
  pageExiste?: boolean;                   // « Découvre son programme expliqué sur notre site » seulement si vrai
  dossier: string;                        // assets (polices, objets)
  parSlide?: 2 | 3;                       // mesures par slide (3 ; 2 si le texte ne tient pas)
};

export function carrouselProgramme(d: DonneesProgramme): Page[] {
  const rub = d.rubrique ?? "Présidentielles 2027";
  const parSlide = d.parSlide ?? 3;
  // Un thème de plus de `parSlide` mesures s'étale sur plusieurs slides (« Si un texte déborde, répartis-le »).
  const slides = d.themes.filter(t => t.mesures.length).flatMap(t => {
    const morceaux: typeof t[] = [];
    for (let i = 0; i < t.mesures.length; i += parSlide) morceaux.push({ ...t, mesures: t.mesures.slice(i, i + parSlide) });
    return morceaux;
  }).slice(0, 8);
  const n = slides.length + 2;
  const c = PALETTES[d.palette];
  const tete = (i: number) => `<div class="tete">${logo(c.accent, c.surAccent)}<div class="A rub">${echapper(rub)}</div><div class="page">${pagination(i, n)}</div></div>`;
  const [prenom, nom] = coupeNom(d.candidat);
  const pages: Page[] = [];
  pages.push({
    nom: "01", format: "carre", html: cadre(d.palette, "carre", `${tete(1)}
<div class="corps">
  <div class="A titre" data-ajuster style="font-size:196px;margin-top:40px">Programme</div>
  <div class="A titre" data-ajuster style="font-size:150px;margin-top:18px">${echapper(prenom)}<br><span class="cartouche">${echapper(nom)}</span></div>
  <div class="trait" style="margin-top:50px"></div>
  ${d.pageExiste !== false ? `<div class="accroche" style="max-width:480px;margin-top:20px">Découvre son programme expliqué sur notre site.</div>` : ""}
  <div class="bandeau-serie" style="margin-top:auto;margin-bottom:34px">Voici un aperçu de ses idées ${FLECHE}</div>
</div>
<img class="portrait" src="${d.portrait}">
${d.creditPhoto ? `<div class="credit" style="right:24px;bottom:18px">${echapper(d.creditPhoto)}</div>` : ""}`),
  });
  slides.forEach((t, k) => {
    const objet = t.objet ?? objetPour(`${t.titre} ${t.mesures.map(m => `${m.titre} ${m.detail}`).join(" ")}`, d.dossier);
    pages.push({
      nom: String(k + 2).padStart(2, "0"), format: "carre", html: cadre(d.palette, "carre", `${tete(k + 2)}
<div class="corps">
  <div class="attribution">Programme ${/^[aeiouyàâäéèêëîïôöùûü]/i.test(d.candidat) ? "d’" : "de "}${echapper(d.candidat)}</div>
  <div class="A titre" data-ajuster style="font-size:${t.titre.length > 22 ? 116 : 148}px;max-width:920px">${echapper(t.titre)}</div>
  <div class="trait"></div>
  <div class="mesures" style="max-width:690px">${t.mesures.map((m, i) => `
    <div class="mesure"><div class="n">${String(i + 1).padStart(2, "0")}</div><div class="A t" data-ajuster>${echapper(m.titre)}</div><div class="d" data-ajuster>${echapper(m.detail)}</div></div>`).join("")}
  </div>
</div>
${eclat(c.accent, "eclat eclat-objet")}<img class="objet" src="${objet}">
<div class="pied"><div><div class="site">lapolitiquecestsimple.fr</div><div class="quoi">Propositions du programme</div></div><div class="source">Source : ${echapper(t.source)}</div></div>`),
    });
  });
  const [grande, ...petites] = (d.captures ?? []).filter(Boolean);
  pages.push({
    nom: String(n).padStart(2, "0"), format: "carre", html: cadre(d.palette, "carre", `${tete(n)}
<div class="corps">
  <div class="A titre" data-ajuster style="font-size:${grande ? 88 : 130}px;margin-top:34px">Suis les candidats à la présidentielle <span class="cartouche">sur notre site</span></div>
  ${grande ? `<div class="captures"><div class="capture grande"><img src="${grande}"></div>${petites.slice(0, 2).map(u => `<div class="capture"><img src="${u}"></div>`).join("")}</div>` : `<div style="flex:1"></div>`}
  <div class="bandeau">lapolitiquecestsimple.fr · lien en bio ${FLECHE}</div>
</div>`),
  });
  return pages;
}

// ─── Gabarit B : affiche « Les programmes en détail » ─────────────────────────

export type DonneesAffiche = {
  nom: string;                            // « David Lisnard », « Mélenchon »
  liaison?: string;                       // « pour la » (ligne simple, facultative)
  theme: string;                          // « santé ? » — seul dans le cartouche arrondi
  contexte?: string;                      // « La France dans le monde »
  portrait: string;
  objet: string;                          // URL de l'objet (globe, stéthoscope…)
  creditPhoto?: string;
  palette: NomPalette;
  format: "story" | "carre";              // 9:16 (story, couverture de reel) ou 4:5 (fil)
};

export function affiche(d: DonneesAffiche): Page {
  const c = PALETTES[d.palette];
  const story = d.format === "story";
  const t = story ? 1 : 0.74;   // le 4:5 recompose l'affiche à 74 %
  // Le cartouche rétrécit seul pour tenir sur une ligne (Anton ≈ 0,45 em par signe, 930 px utiles) :
  // la question garde sa taille.
  const tailleTheme = Math.min(168 * t, Math.floor(930 / (Math.max(d.theme.length, 4) * 0.45)));
  return {
    nom: story ? "affiche-story" : "affiche-fil", format: d.format, html: cadre(d.palette, d.format, `
<div class="tete"><div class="marque">${logo(c.accent, c.surAccent)}<div class="A nom" style="font-size:${64 * t}px">La politique<br>c’est simple</div></div></div>
<div class="corps">
  <div class="serie" style="font-size:${32 * t}px;margin-top:${54 * t}px">Les programmes en détail</div>
  <div class="A question" data-ajuster style="font-size:${168 * t}px">Que propose<br>${echapper(d.nom)}<br>${d.liaison ? `${echapper(d.liaison)}<br>` : ""}<span class="cartouche arrondi" style="font-size:${tailleTheme}px">${echapper(d.theme)}</span></div>
  ${d.contexte ? `<div class="contexte" style="font-size:${32 * t}px">${echapper(d.contexte)}</div>` : ""}
</div>
${eclat(c.accent, "eclat")}
<style>.pal-${d.palette}.${d.format} .eclat { left: ${story ? 250 : 175}px; bottom: ${story ? 700 : 485}px; }</style>
<img class="objet" src="${d.objet}" style="left:70px;right:auto;bottom:${story ? 240 : 150}px;width:${story ? 400 : 300}px">
<img class="portrait" src="${d.portrait}" style="width:${story ? 780 : 560}px;height:${story ? 1180 : 760}px">
<div class="site-bas" style="font-size:${38 * t}px">lapolitiquecestsimple.fr</div>
${d.creditPhoto ? `<div class="credit" style="right:24px;bottom:18px">${echapper(d.creditPhoto)}</div>` : ""}`),
  };
}

// ─── Famille actu (bleu électrique, menthe, papier déchiré) ───────────────────

/** Un bloc de slide « actu ». Les blocs se suivent de haut en bas. */
export type BlocActu =
  | { genre: "etiquette"; texte: string }                 // CONTEXTE (menthe)
  | { genre: "titre"; lignes: string[]; suite?: string }  // + DE 500 000 / SIGNATURES (bandes noires) + « requises »
  | { genre: "chiffre"; valeur: string; texte: string }   // 30 | dans au moins 30 départements…
  | { genre: "paragraphe"; texte: string }
  | { genre: "conclusion"; texte: string };               // CE N'EST PAS AUTOMATIQUE. (menthe)

export type SlideActu = { blocs: BlocActu[]; source?: string; visuel?: string };   // visuel = nom d'objet (« sante ») ou URL

export function carrouselActu(d: { slides: SlideActu[]; captures?: string[]; dossier: string }): Page[] {
  const [grande, ...petites] = (d.captures ?? []).filter(Boolean);
  const n = d.slides.length + (grande ? 1 : 0);
  const tete = `<div class="tete">${eclat("#fff", "eclat eclat-logo")}<div class="marque-actu">${logoOrigine()}<div class="sep"></div><div class="A nom">La politique<br>c’est simple</div></div></div>`;
  let compact = false;   // plusieurs chiffres sur une slide : format liste
  const bloc = (b: BlocActu) => {
    switch (b.genre) {
      case "etiquette": return `<div class="dechire menthe A etiq" style="margin-top:34px">${echapper(b.texte)}</div>`;
      case "titre": return `<div style="display:flex;flex-direction:column;margin-top:18px">${b.lignes.map((l, i) => `<div class="dechire noir A gros ${i % 2 ? "n2" : ""}" data-ajuster>${echapper(l)}</div>`).join("")}${b.suite ? `<div class="sous">${echapper(b.suite)}</div>` : ""}</div>`;
      case "chiffre": return `<div class="chiffre${compact ? " compact" : ""}"><div class="dechire menthe A v" data-ajuster>${echapper(b.valeur)}</div><div class="l" data-ajuster>${echapper(b.texte)}</div></div>`;
      case "paragraphe": return `<div class="para" data-ajuster>${echapper(b.texte)}</div>`;
      case "conclusion": return `<div class="dechire menthe A moyen n2" style="margin-top:30px" data-ajuster>${echapper(b.texte)}</div>`;
    }
  };
  const texteDe = (s: SlideActu) => s.blocs.map(b => ("texte" in b ? b.texte : "lignes" in b ? b.lignes.join(" ") : "") + ("valeur" in b ? b.valeur : "")).join(" ");
  const objet = (s: SlideActu) => s.visuel && /^https?:|^file:/.test(s.visuel) ? s.visuel : `${d.dossier}/objets/${s.visuel || nomObjet(texteDe(s))}.png`;
  const pages: Page[] = d.slides.map((s, i) => ({
    nom: String(i + 1).padStart(2, "0"), format: "carre" as const, html: cadreActu(`${tete}
<div class="corps" style="max-width:900px">${(compact = s.blocs.filter(b => b.genre === "chiffre").length > 1, s.blocs.map(bloc).join(""))}</div>
${eclat(ACTU.accent, "eclat eclat-objet")}<img class="objet" src="${objet(s)}">
<div class="pied">${s.source ? `<div class="src-actu"><b>Source :</b> ${echapper(s.source)}</div>` : "<div></div>"}</div>
<div class="dechire menthe page-actu">${pagination(i + 1, n)}</div>`),
  }));
  if (grande) pages.push({
    nom: String(n).padStart(2, "0"), format: "carre", html: cadreActu(`${tete}
<div class="corps">
  <div class="dechire noir A gros" style="margin-top:40px;font-size:104px" data-ajuster>Tout est expliqué</div>
  <div class="dechire menthe A moyen n2">sur notre site</div>
  <div class="captures"><div class="capture grande"><img src="${grande}"></div>${petites.slice(0, 2).map(u => `<div class="capture"><img src="${u}"></div>`).join("")}</div>
  <div class="bandeau">lapolitiquecestsimple.fr · lien en bio ${FLECHE}</div>
</div>`),
  });
  return pages;
}
