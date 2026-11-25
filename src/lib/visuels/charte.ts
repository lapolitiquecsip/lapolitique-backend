/**
 * Charte Instagram v2 (Rose, graphiste — 25/11/2026), d'après les visuels faits main par Hippolyte
 * (exemplespostinsta) :
 * - famille « programme » : fond rose pâle, encre bordeaux, portrait noir et blanc détouré ;
 * - famille « actu » : bleu électrique, étiquettes menthe et bandes noires en papier déchiré ;
 * - une couleur par FAMILLE, jamais par candidat ou parti (neutralité) ; la story 9:16 prend la
 *   couleur de sa famille.
 * Titres en Anton (condensé, majuscules), texte en Lexend. 3 points par slide, numérotés 01-03,
 * source précise en bas de chaque slide, site + « lien en bio » en dernière slide.
 *
 * Les textes sont échappés ; rien n'est inventé ici : une donnée absente retire son bloc.
 */

export const FORMAT = { carre: { largeur: 1080, hauteur: 1350 }, story: { largeur: 1080, hauteur: 1920 } };

export type Page = { html: string; nom: string; format: keyof typeof FORMAT };

export type Famille = "programme" | "actu";

const COULEURS = {
  programme: { fond: "#F1BCCD", encre: "#4A1531", clair: "#FFF4F7", accent: "#4A1531" },
  actu: { fond: "#1E2BF0", encre: "#0B0B12", clair: "#FFFFFF", accent: "#8FF0CF" },
};

export const echapper = (t: string) =>
  String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "’")
    .replace(/ ([%?!:;»])/g, " $1").replace(/« /g, "« ").replace(/(\d) (\d{3})\b/g, "$1 $2");

/** Le temple et sa flèche, dans un carré arrondi (logo des visuels faits main). */
export const logo = (fond: string, trait = "#fff") => `
<svg class="logo" viewBox="0 0 120 120"><rect width="120" height="120" rx="26" fill="${fond}"/>
<g fill="none" stroke="${trait}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
<path d="M28 44 L56 28 L84 44 Z"/><path d="M34 52v26M47 52v26M60 52v26M73 52v26"/><path d="M26 86h46"/><path d="M80 86h16M90 80l6 6-6 6"/></g></svg>`;

/** Petits traits d'éclat ( \ | / ) au-dessus d'un objet ou d'un logo. */
const eclat = (couleur: string, classe = "eclat") =>
  `<svg class="${classe}" viewBox="0 0 120 80" fill="none" stroke="${couleur}" stroke-width="9" stroke-linecap="round"><path d="M20 62 L8 40"/><path d="M58 52 L56 14"/><path d="M92 60 L112 36"/></svg>`;

const FLECHE = `<svg class="fleche" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16M14 6l6 6-6 6"/></svg>`;

/** Filtres SVG : bord de papier déchiré, grain de papier. Inclus une fois par page. */
const FILTRES = `<svg width="0" height="0" style="position:absolute"><defs>
<filter id="dechire" x="-5%" y="-20%" width="110%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.055 0.09" numOctaves="3" seed="7"/><feDisplacementMap in="SourceGraphic" scale="14"/></filter>
<filter id="dechire2" x="-5%" y="-20%" width="110%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.07 0.05" numOctaves="3" seed="3"/><feDisplacementMap in="SourceGraphic" scale="12"/></filter>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .5 0"/></filter>
</defs></svg>`;

export const CSS_CHARTE = (dossier: string) => `
@font-face { font-family: Anton; src: url("${dossier}/anton-latin-400-normal.woff2"); }
@font-face { font-family: AntonExt; src: url("${dossier}/anton-latin-ext-400-normal.woff2"); }
${[500, 600, 700].map(p => `@font-face { font-family: Lexend; font-weight: ${p}; src: url("${dossier}/lexend-latin-${p}-normal.woff2"); }
@font-face { font-family: LexendExt; font-weight: ${p}; src: url("${dossier}/lexend-latin-ext-${p}-normal.woff2"); }`).join("\n")}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #000; }
.slide { position: relative; overflow: hidden; display: flex; flex-direction: column; padding: 58px 70px 54px;
  font-family: Lexend, LexendExt, sans-serif; color: var(--encre); background: var(--fond); }
.slide.carre { width: 1080px; height: 1350px; }
.slide.story { width: 1080px; height: 1920px; padding: 120px 70px 110px; }
.slide::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .08; mix-blend-mode: multiply;
  background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='300' height='300' filter='url(%23g)'/></svg>"); z-index: 5; }
.A { font-family: Anton, AntonExt, sans-serif; font-weight: 400; text-transform: uppercase; line-height: 1.1; letter-spacing: .002em; }
.tete { display: flex; align-items: center; gap: 24px; position: relative; z-index: 3; flex: none; }
.logo { width: 92px; height: 92px; flex: none; }
.rub { font-size: 50px; }
.page { margin-left: auto; font-weight: 600; font-size: 27px; letter-spacing: .02em; }
.corps { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; position: relative; z-index: 3; }
.surtitre { font-weight: 600; font-size: 28px; text-transform: uppercase; letter-spacing: .02em; margin-top: 40px; }
.titre { font-size: 150px; margin-top: 18px; }
.bloc { display: inline-block; background: var(--encre); color: #fff; padding: 2px 18px 0; margin-left: -6px; }
.filet { width: 136px; height: 14px; background: var(--encre); margin: 34px 0 6px; flex: none; }
.texte { font-weight: 600; font-size: 40px; line-height: 1.24; }
.bouton { display: inline-flex; align-items: center; gap: 16px; align-self: flex-start; background: var(--encre); color: #fff; font-weight: 600; font-size: 34px; padding: 16px 26px; }
.fleche { width: 36px; height: 36px; flex: none; }
.points { display: flex; flex-direction: column; margin-top: 18px; }
.point { display: grid; grid-template-columns: 72px 1fr; column-gap: 26px; padding: 26px 0; border-top: 2px solid color-mix(in srgb, var(--encre) 55%, transparent); }
.point:first-child { border-top: 0; }
.point .n { align-self: start; margin-top: 10px; background: var(--encre); color: #fff; font-weight: 700; font-size: 28px; text-align: center; padding: 6px 0; }
.point .t { font-size: 64px; }
.point .d { grid-column: 2; font-weight: 500; font-size: 35px; line-height: 1.24; margin-top: 8px; }
.pied { display: flex; align-items: flex-end; justify-content: space-between; gap: 30px; margin-top: auto; padding-top: 22px; position: relative; z-index: 3; flex: none; }
.pied .site { font-weight: 700; font-size: 31px; }
.pied .quoi { font-weight: 600; font-size: 21px; text-transform: uppercase; letter-spacing: .03em; margin-top: 8px; }
.source { font-weight: 600; font-size: 21px; text-transform: uppercase; letter-spacing: .02em; text-align: right; max-width: 52%; }
.credit { position: absolute; z-index: 4; font-weight: 500; font-size: 15px; color: #222; background: rgba(255,255,255,.6); padding: 2px 8px; }
.portrait { position: absolute; z-index: 2; right: 0; bottom: 0; width: 600px; height: 880px; object-fit: contain; object-position: right bottom; }
.objet { position: absolute; z-index: 2; right: 56px; bottom: 120px; width: 320px; image-rendering: auto;
  filter: drop-shadow(4px 0 0 #fff) drop-shadow(-4px 0 0 #fff) drop-shadow(0 4px 0 #fff) drop-shadow(0 -4px 0 #fff); }
.eclat-objet { right: 250px; bottom: 440px; width: 96px; }
.actu .objet { bottom: 110px; width: 360px; }
.actu .eclat-objet { right: 300px; bottom: 460px; }
.eclat { position: absolute; z-index: 3; width: 110px; }
/* — actu — */
.actu { color: #fff; }
.marque { display: flex; align-items: center; gap: 22px; }
.marque .sep { width: 4px; height: 92px; background: #fff; border-radius: 2px; }
.marque .nom { font-size: 52px; line-height: .98; }
.dechire { position: relative; display: inline-block; align-self: flex-start; color: var(--encre); padding: 8px 26px 4px; margin: 6px 0; }
.dechire::before { content: ""; position: absolute; inset: 0; background: var(--fond-bande, #fff); filter: url(#dechire); z-index: -1; }
.dechire.noir { --fond-bande: #0B0B12; color: #fff; }
.dechire.menthe { --fond-bande: ${COULEURS.actu.accent}; color: #0B0B12; }
.dechire.n2::before { filter: url(#dechire2); }
.etiq { font-size: 64px; }
.gros { font-size: 136px; }
.moyen { font-size: 64px; }
.chiffre { display: flex; align-items: center; gap: 34px; margin-top: 26px; }
.chiffre .v { font-size: 250px; padding: 10px 34px 0; flex: none; }
.chiffre.compact { margin-top: 18px; }
.chiffre.compact .v { font-size: 120px; min-width: 150px; text-align: center; padding: 6px 22px 0; }
.chiffre.compact .l { font-size: 46px; }
.chiffre .l { font-weight: 600; font-size: 50px; line-height: 1.12; }
.para { font-weight: 600; font-size: 36px; line-height: 1.25; margin-top: 26px; max-width: 800px; }
.sous { font-weight: 700; font-size: 72px; margin-top: 4px; align-self: center; }
.src-actu { font-weight: 500; font-size: 22px; }
.src-actu b { font-weight: 700; }
.page-actu { position: absolute; right: 60px; bottom: 50px; z-index: 4; font-size: 34px; font-weight: 700; }
.batiment { position: absolute; right: -110px; bottom: -30px; width: 860px; z-index: 1; filter: grayscale(1) contrast(1.15); }
.actu .eclat-logo { position: absolute; left: 70px; top: -44px; width: 52px; }
.src-actu { max-width: 46%; position: relative; z-index: 4; }
/* — dernière slide — */
.capture { margin-top: 30px; border: 6px solid var(--encre); box-shadow: 18px 18px 0 var(--encre); background: #fff; overflow: hidden; flex: 1 1 auto; min-height: 0; }
.capture img { width: 100%; display: block; }
.bandeau { margin-top: 44px; display: flex; align-items: center; gap: 18px; background: var(--encre); color: #fff; font-weight: 700; font-size: 38px; padding: 20px 28px; align-self: stretch; justify-content: center; }
.actu .bandeau { background: ${COULEURS.actu.accent}; color: #0B0B12; }
.actu .capture { border-color: #fff; box-shadow: 18px 18px 0 ${COULEURS.actu.accent}; }
`;

const cadre = (f: Famille, format: keyof typeof FORMAT, contenu: string, classes = "") => {
  const c = COULEURS[f];
  return `${FILTRES}<section class="slide ${format} ${f} ${classes}" style="--fond:${c.fond};--encre:${c.encre}">${contenu}</section>`;
};

/**
 * La bibliothèque d'objets noir et blanc (assets/visuels/objets, générés par Hippolyte le 25/11) :
 * chaque slide a son image à droite (« pour chaque post, image en noir et blanc de haute qualité,
 * à droite »). L'ordre compte : « sécurité sociale » est de la santé avant d'être de la sécurité.
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

/** L'objet qui illustre un texte (titre de thème, actu…) ; à défaut, les colonnes des institutions. */
export const objetPour = (texte: string, dossier: string) =>
  `${dossier}/objets/${(OBJETS.find(([r]) => r.test(texte)) ?? [null, "institutions"])[1]}.png`;

const pagination = (i: number, n: number) => `${String(i).padStart(2, "0")} / ${String(n).padStart(2, "0")}`;

// ─── Programme d'un candidat ──────────────────────────────────────────────────

export type DonneesProgramme = {
  candidat: string;                       // « Dominique de Villepin »
  slug: string;
  rubrique?: string;                      // « Présidentielles 2027 »
  portrait: string;                       // URL du PNG détouré noir et blanc
  creditPhoto?: string;                   // « Photo : X · CC BY-SA 3.0 · Wikimedia Commons »
  themes: { titre: string; points: { titre: string; detail: string }[]; source: string; objet?: string }[];
  capture?: string;                       // capture de la fiche du site (dernière slide)
  totalPropositions?: number;
  dossier: string;                        // assets (polices, objets)
};

const coupeNom = (nom: string) => {
  const m = nom.split(" ");
  // « Dominique | de Villepin », « Jean-Luc | Mélenchon », « Marine | Le Pen »
  const i = m.findIndex((x, k) => k > 0 && (/^(de|du|des|le|la|d’|d')$/i.test(x) || k === m.length - 1));
  return [m.slice(0, i).join(" "), m.slice(i).join(" ")];
};

export function carrouselProgramme(d: DonneesProgramme): Page[] {
  const rub = d.rubrique ?? "Présidentielles 2027";
  const themes = d.themes.filter(t => t.points.length).slice(0, 8);
  const n = themes.length + 2;
  const c = COULEURS.programme;
  const tete = (i: number) => `<div class="tete">${logo(c.encre)}<div class="A rub">${echapper(rub)}</div><div class="page">${pagination(i, n)}</div></div>`;
  const [prenom, nom] = coupeNom(d.candidat);
  const pages: Page[] = [];
  pages.push({
    nom: "01", format: "carre", html: cadre("programme", "carre", `${tete(1)}
<div class="corps">
  <div class="A titre" data-ajuster style="font-size:190px;margin-top:44px">Programme</div>
  <div class="A titre" data-ajuster style="font-size:150px;margin-top:26px">${echapper(prenom)}<br><span class="bloc">${echapper(nom)}</span></div>
  <div class="filet" style="margin-top:56px"></div>
  <div class="texte" style="max-width:520px;margin-top:22px">Découvre son programme intégralement expliqué sur notre site !</div>
  <div class="bouton" style="margin-top:auto;margin-bottom:40px">Voici un aperçu de ses idées ${FLECHE}</div>
</div>
<img class="portrait" src="${d.portrait}">
${d.creditPhoto ? `<div class="credit" style="right:24px;bottom:18px">${echapper(d.creditPhoto)}</div>` : ""}`),
  });
  themes.forEach((t, k) => {
    const objet = t.objet ?? objetPour(`${t.titre} ${t.points.map(p => `${p.titre} ${p.detail}`).join(" ")}`, d.dossier);
    pages.push({
      nom: String(k + 2).padStart(2, "0"), format: "carre", html: cadre("programme", "carre", `${tete(k + 2)}
<div class="corps">
  <div class="surtitre">Programme de ${echapper(d.candidat)}</div>
  <div class="A titre" data-ajuster style="font-size:${t.titre.length > 22 ? 118 : 150}px;max-width:900px">${echapper(t.titre)}</div>
  <div class="filet"></div>
  <div class="points" style="max-width:680px">${t.points.slice(0, 3).map((p, i) => `
    <div class="point"><div class="n">${String(i + 1).padStart(2, "0")}</div><div class="A t" data-ajuster>${echapper(p.titre)}</div><div class="d" data-ajuster>${echapper(p.detail)}</div></div>`).join("")}
  </div>
</div>
${eclat(c.encre, "eclat eclat-objet")}<img class="objet" src="${objet}">
<div class="pied"><div><div class="site">lapolitiquecestsimple.fr</div><div class="quoi">Propositions du programme</div></div><div class="source">Source : ${echapper(t.source)}</div></div>`),
    });
  });
  pages.push({
    nom: String(n).padStart(2, "0"), format: "carre", html: cadre("programme", "carre", `${tete(n)}
<div class="corps">
  <div class="A titre" data-ajuster style="font-size:92px;margin-top:40px">Tout son programme,<br><span class="bloc">expliqué simplement</span></div>
  <div class="texte" style="margin-top:26px">${d.totalPropositions ? `${d.totalPropositions} propositions, ` : ""}classées par thème, avec la source de chacune.</div>
  ${d.capture ? `<div class="capture"><img src="${d.capture}"></div>` : `<div style="flex:1"></div>`}
  <div class="bandeau">lapolitiquecestsimple.fr · lien en bio ${FLECHE}</div>
</div>`),
  });
  return pages;
}

/** Story 9:16 « Que propose X sur Y ? » — couleur de la famille programme. */
export function storyProgramme(d: { candidat: string; theme: string; question: string; portrait: string; objet?: string; creditPhoto?: string }): Page {
  const c = COULEURS.programme;
  const nom = d.candidat.split(" ").slice(-1)[0];
  return {
    nom: "story", format: "story", html: cadre("programme", "story", `
<div class="tete">${logo(c.encre)}<div class="A rub" style="font-size:64px;line-height:.98">La politique<br>c’est simple</div></div>
<div class="corps">
  <div class="surtitre" style="font-size:34px;letter-spacing:.18em;margin-top:56px">Les programmes en détail</div>
  <div class="A titre" data-ajuster style="font-size:170px;margin-top:24px">Que propose<br>${echapper(d.candidat.includes(" de ") ? d.candidat.split(" ").slice(-2).join(" ") : nom)}<br><span class="bloc" style="font-size:130px">${echapper(d.question)}</span></div>
  <div class="surtitre" style="font-size:34px;letter-spacing:.12em;margin-top:30px">${echapper(d.theme)}</div>
  <div class="pied" style="margin-top:auto"><div class="site" style="font-size:40px;background:#fff;padding:6px 12px">lapolitiquecestsimple.fr</div></div>
</div>
${d.objet ? `${eclat(c.encre, "eclat")}<img class="objet" src="${d.objet}" style="left:70px;right:auto;bottom:330px;width:380px">` : ""}
<img class="portrait" src="${d.portrait}" style="width:760px;height:1020px">
${d.creditPhoto ? `<div class="credit" style="right:30px;bottom:24px">${echapper(d.creditPhoto)}</div>` : ""}`),
  };
}

// ─── Actu décryptée ───────────────────────────────────────────────────────────

/** Un bloc de slide « actu ». Les blocs se suivent de haut en bas. */
export type BlocActu =
  | { genre: "etiquette"; texte: string }                 // CONTEXTE (menthe)
  | { genre: "titre"; lignes: string[]; suite?: string }  // + DE 500 000 / SIGNATURES (bandes noires) + « requises »
  | { genre: "chiffre"; valeur: string; texte: string }   // 30 | dans au moins 30 départements…
  | { genre: "paragraphe"; texte: string }
  | { genre: "conclusion"; texte: string };               // CE N'EST PAS AUTOMATIQUE. (menthe)

export type SlideActu = { blocs: BlocActu[]; source?: string; visuel?: "batiment" | string };   // visuel = nom d'objet (« sante »), URL, ou « batiment »

export function carrouselActu(d: { slides: SlideActu[]; capture?: string; dossier: string }): Page[] {
  const n = d.slides.length + (d.capture ? 1 : 0);
  const tete = `<div class="tete">${eclat("#fff", "eclat eclat-logo")}<div class="marque">${logo("#EC2A8E")}<div class="sep"></div><div class="A nom">La politique<br>c’est simple</div></div></div>`;
  let compact = false;   // plusieurs chiffres sur une slide : format liste
  const bloc = (b: BlocActu, k: number) => {
    switch (b.genre) {
      case "etiquette": return `<div class="dechire menthe A etiq" style="margin-top:34px">${echapper(b.texte)}</div>`;
      case "titre": return `<div style="display:flex;flex-direction:column;margin-top:18px">${b.lignes.map((l, i) => `<div class="dechire noir A gros ${i % 2 ? "n2" : ""}" data-ajuster>${echapper(l)}</div>`).join("")}${b.suite ? `<div class="sous">${echapper(b.suite)}</div>` : ""}</div>`;
      case "chiffre": return `<div class="chiffre${compact ? " compact" : ""}"><div class="dechire menthe A v" data-ajuster>${echapper(b.valeur)}</div><div class="l" data-ajuster>${echapper(b.texte)}</div></div>`;
      case "paragraphe": return `<div class="para" data-ajuster>${echapper(b.texte)}</div>`;
      case "conclusion": return `<div class="dechire menthe A moyen n2" style="margin-top:30px" data-ajuster>${echapper(b.texte)}</div>`;
    }
    void k;
  };
  const texteDe = (s: SlideActu) => s.blocs.map(b => ("texte" in b ? b.texte : "lignes" in b ? b.lignes.join(" ") : "") + ("valeur" in b ? b.valeur : "")).join(" ");
  // Chaque slide a son image noir et blanc à droite : l'objet du thème, ou le bâtiment si demandé.
  const visuel = (s: SlideActu) => s.visuel === "batiment"
    ? `<div class="eclat" style="right:70px;bottom:420px;position:absolute">${eclat(COULEURS.actu.accent)}</div><img class="batiment" src="${d.dossier}/assemblee.png">`
    : `${eclat(COULEURS.actu.accent, "eclat eclat-objet")}<img class="objet" src="${s.visuel && /^https?:|^file:/.test(s.visuel) ? s.visuel : s.visuel ? `${d.dossier}/objets/${s.visuel}.png` : objetPour(texteDe(s), d.dossier)}">`;
  const pages: Page[] = d.slides.map((s, i) => ({
    nom: String(i + 1).padStart(2, "0"), format: "carre" as const, html: cadre("actu", "carre", `${tete}
<div class="corps" style="max-width:900px">${(compact = s.blocs.filter(b => b.genre === "chiffre").length > 1, s.blocs.map(bloc).join(""))}</div>
${visuel(s)}
<div class="pied">${s.source ? `<div class="src-actu"><b>Source :</b> ${echapper(s.source)}</div>` : "<div></div>"}</div>
<div class="dechire menthe page-actu">${pagination(i + 1, n)}</div>`),
  }));
  if (d.capture) pages.push({
    nom: String(n).padStart(2, "0"), format: "carre", html: cadre("actu", "carre", `${tete}
<div class="corps">
  <div class="dechire noir A gros" style="margin-top:40px;font-size:110px" data-ajuster>Tout est expliqué</div>
  <div class="dechire menthe A moyen n2">sur notre site</div>
  <div class="capture"><img src="${d.capture}"></div>
  <div class="bandeau">lapolitiquecestsimple.fr · lien en bio ${FLECHE}</div>
</div>`),
  });
  return pages;
}
