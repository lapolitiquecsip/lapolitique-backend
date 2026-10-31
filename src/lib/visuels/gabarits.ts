/**
 * Gabarits des visuels Instagram et LinkedIn, d'après les maquettes de la page
 * Notion « Design et ressources — LPCS ».
 *
 * Tout est dessiné en HTML puis photographié : les chiffres affichés sont ceux
 * qu'on passe ici, jamais redessinés par un modèle d'image. Une donnée absente
 * retire sa slide au lieu de laisser un texte d'attente.
 */

export const LARGEUR = 1080;
export const HAUTEUR = 1350;

export type Palette = { fond: string; accent: string; clair: string };

export const PALETTES = {
  vert: { fond: "#0B5A45", accent: "#0B7A4B", clair: "#D3F59A" },
  cobalt: { fond: "#2B4FD8", accent: "#2B4FD8", clair: "#E2F77A" },
  rose: { fond: "#E5007D", accent: "#E5007D", clair: "#B6F5B0" },
} satisfies Record<string, Palette>;

export type Slide = { html: string; nom: string };

const echapper = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "’").replace(/ ([%?!:;»])/g, " $1").replace(/« /g, "« ");

const FLECHE = `<svg class="fleche" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16M14 6l6 6-6 6"/></svg>`;
const LIEN_EXT = `<svg class="ext" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>`;

export const CSS = (dossier: string) => `
@font-face { font-family: Archivo; src: url("${dossier}/archivo-latin-standard-normal.woff2"); font-weight: 100 900; font-stretch: 62% 125%; }
@font-face { font-family: ArchivoExt; src: url("${dossier}/archivo-latin-ext-standard-normal.woff2"); font-weight: 100 900; font-stretch: 62% 125%; }
@font-face { font-family: Anton; src: url("${dossier}/anton-latin-400-normal.woff2"); }
@font-face { font-family: AntonExt; src: url("${dossier}/anton-latin-ext-400-normal.woff2"); }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
.slide { --fond: #0B5A45; --accent: #0B7A4B; --clair: #D3F59A; --encre: #0A1230;
  position: relative; width: ${LARGEUR}px; height: ${HAUTEUR}px; overflow: hidden; display: flex; flex-direction: column;
  padding: 56px 64px 52px; font-family: Archivo, ArchivoExt, sans-serif; color: var(--encre); background: #fff; }
.slide.pleine { background: var(--fond); color: #fff; }
.tete { display: flex; align-items: center; gap: 22px; flex: none; position: relative; z-index: 2; }
.tete img { width: 84px; height: 84px; }
.marque { font-weight: 700; font-size: 31px; line-height: 1.08; letter-spacing: -.01em; }
.rubrique { margin-left: auto; font-size: 20px; letter-spacing: .05em; text-transform: uppercase; opacity: .72; }
.page { font-size: 25px; margin-left: 36px; font-variant-numeric: tabular-nums; }
.titre { font-family: Anton, AntonExt, sans-serif; font-weight: 400; line-height: 1.24; letter-spacing: .003em; text-transform: uppercase; }
.geant { font-size: 176px; text-transform: uppercase; }
.grand { font-size: 150px; }
.corps { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; position: relative; z-index: 2; }
.etiquette { display: inline-block; align-self: flex-start; background: var(--clair); color: var(--encre); font-weight: 800; font-stretch: 85%;
  font-size: 36px; padding: 6px 22px; border-radius: 6px; letter-spacing: .01em; text-transform: uppercase; margin-bottom: 26px; }
.surligne { display: inline-block; background: #14A04F; color: #fff; padding: 4px 26px 10px; margin-left: -10px; margin-top: 8px; }
.filet { width: 190px; height: 16px; background: var(--clair); margin-top: 30px; flex: none; }
.clair { color: var(--clair); }
.sous { font-size: 46px; font-weight: 500; font-stretch: 100%; line-height: 1.14; }
.petit { font-size: 30px; opacity: .85; }
.points { margin-top: 30px; flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; }
.point { display: flex; align-items: center; gap: 34px; padding: 34px 0; border-top: 3px solid color-mix(in srgb, var(--accent) 45%, #c9d0dc); }
.point:first-child { border-top: 0; }
.num { font-family: Anton, AntonExt, sans-serif; font-weight: 400; font-size: 136px; line-height: 1; color: var(--accent); min-width: 130px; }
.point .txt { border-left: 3px solid #c9d0dc; padding-left: 34px; }
.point b { display: block; font-size: 50px; font-weight: 700; font-stretch: 88%; line-height: 1.12; }
.point span { display: block; font-size: 38px; line-height: 1.22; margin-top: 8px; color: #27304f; }
.bas { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-top: auto; padding-top: 26px; position: relative; z-index: 2; }
.bouton { display: inline-flex; align-items: center; gap: 14px; background: var(--clair); color: var(--encre); font-weight: 700; font-stretch: 88%; font-size: 31px; padding: 15px 26px; border-radius: 12px; }
.fleche { width: 34px; height: 34px; flex: none; }
.ext { width: 36px; height: 36px; flex: none; }
.site { font-size: 27px; font-weight: 500; }
.ligne-res { display: flex; align-items: center; gap: 42px; padding: 20px 0; border-top: 3px solid #c9d0dc; font-family: Anton, AntonExt, sans-serif; font-weight: 400; }
.ligne-res:first-child { border-top: 0; }
.ligne-res .n { font-size: 130px; line-height: 1; min-width: 215px; font-variant-numeric: tabular-nums; }
.ligne-res .l { font-size: 112px; line-height: 1; border-left: 3px solid #c9d0dc; padding-left: 42px; text-transform: uppercase; }
table { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 22px; font-size: 32px; }
th { color: #fff; font-weight: 800; font-stretch: 85%; padding: 13px 8px; font-size: 27px; }
th:first-child { background: #e8ebf1; color: var(--encre); text-align: left; padding-left: 20px; }
td { padding: 10.5px 8px; text-align: center; border-bottom: 2px solid #dfe3ea; font-variant-numeric: tabular-nums; }
td:first-child { text-align: left; padding-left: 20px; font-weight: 600; font-stretch: 90%; }
td.maj { font-weight: 800; }
.note { font-size: 27px; color: #3b4464; line-height: 1.25; margin-top: 16px; }
.liens { display: flex; flex-direction: column; gap: 18px; margin-top: 18px; }
.lien { display: flex; align-items: center; gap: 26px; background: #fff; color: var(--encre); border-radius: 12px; padding: 19px 28px; font-size: 32px; font-weight: 600; font-stretch: 90%; }
.fin-site { font-weight: 800; font-stretch: 85%; font-size: 62px; letter-spacing: -.01em; }
.fond-image { position: absolute; inset: 0; overflow: hidden; z-index: 1; }
.batiment { position: absolute; left: -60px; bottom: 0; width: 1200px; max-width: none; z-index: 1; filter: grayscale(1) contrast(1.05); }
.bande { position: absolute; left: 0; bottom: 0; z-index: 3; background: var(--encre); color: #fff; font-size: 27px; font-weight: 600; padding: 12px 26px 12px 64px; }
.chiffre { font-family: Anton, AntonExt, sans-serif; font-weight: 400; font-size: 320px; line-height: 1; letter-spacing: -.015em; }
.comparaison { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 40px; }
.comparaison > div { padding: 0 34px; border-left: 3px solid #c9d0dc; }
.comparaison > div:first-child { padding-left: 0; border-left: 0; }
.comparaison .p { font-size: 40px; font-weight: 700; font-stretch: 88%; margin-bottom: 16px; }
.encart { background: color-mix(in srgb, var(--clair) 70%, #fff); border-radius: 16px; padding: 26px 32px; font-size: 34px; font-weight: 600; font-stretch: 90%; line-height: 1.2; margin-top: 40px; }
.source { border: 3px solid var(--accent); border-radius: 12px; padding: 14px 22px; font-size: 26px; font-stretch: 92%; line-height: 1.25; }
.source b { font-weight: 800; }
.li .tete .lpcs { font-family: Anton, AntonExt, sans-serif; font-weight: 400; font-size: 66px; line-height: 1; }
.li .tete .sep { width: 3px; height: 54px; background: var(--accent); }
.li .tete .brief { font-size: 27px; letter-spacing: .05em; }
.li .pilier { flex: 1; display: flex; flex-direction: column; justify-content: center; }
.li .barre { border-left: 14px solid var(--accent); padding-left: 44px; }
.li .trois { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 72px; }
.li .trois > div { border-left: 3px solid #c9d0dc; padding: 0 26px; }
.li .trois > div:first-child { border-left: 0; padding-left: 0; }
.li .trois .v { white-space: nowrap; font-family: Anton, AntonExt, sans-serif; font-weight: 400; font-size: 100px; line-height: 1; color: var(--accent); }
.li .trois .t { font-size: 32px; line-height: 1.18; margin-top: 12px; font-stretch: 90%; }
.li .pied { display: flex; justify-content: space-between; align-items: center; font-size: 30px; font-weight: 800; font-stretch: 85%; }
.li .pied span:last-child { font-weight: 500; font-size: 25px; }
`;

const entete = (dossier: string, rubrique: string, i: number, n: number) => `
<div class="tete"><img src="${dossier}/logo.svg" alt=""><div class="marque">La politique,<br>c’est simple.</div>
<div class="rubrique">${echapper(rubrique)}</div><div class="page">${String(i).padStart(2, "0")}/${String(n).padStart(2, "0")}</div></div>`;

const cadre = (p: Palette, classes: string, contenu: string) =>
  `<section class="slide ${classes}" style="--fond:${p.fond};--accent:${p.accent};--clair:${p.clair}">${contenu}</section>`;

const pointsHtml = (points: { titre: string; detail?: string }[]) =>
  `<div class="points">${points.map((x, i) => `<div class="point"><div class="num">${String(i + 1).padStart(2, "0")}</div><div class="txt"><b>${echapper(x.titre)}</b>${x.detail ? `<span>${echapper(x.detail)}</span>` : ""}</div></div>`).join("")}</div>`;

const nombre = (n: number) => n.toLocaleString("fr-FR").replace(/[  ]/g, " ");

// ─── Vote à l'Assemblée nationale ─────────────────────────────────────────────

export type GroupeVote = { nom: string; pour: number; contre: number; abstention: number };

export type DonneesVote = {
  adopte: boolean;
  titreCourt: string;
  date: string;
  etape?: string;
  numero: number;
  pour: number;
  contre: number;
  abstentions: number;
  nonVotants: number;
  groupes: GroupeVote[];
  /** Ce que prévoit le texte, tiré du résumé du site. Sans point, la slide saute. */
  mesures: { titre: string; detail?: string }[];
  /** La suite du parcours, seulement si on la connaît. Sans étape, la slide saute. */
  suite?: { titre: string; detail?: string }[];
  lienScrutin: string;
  lienDossier?: string;
};

/** Le total des groupes doit retomber sur le résultat officiel, sinon on ne dessine rien. */
export function controlerVote(d: DonneesVote): string[] {
  const somme = (c: "pour" | "contre" | "abstention") => d.groupes.reduce((s, g) => s + g[c], 0);
  const erreurs: string[] = [];
  if (somme("pour") !== d.pour) erreurs.push(`pour : groupes ${somme("pour")} ≠ scrutin ${d.pour}`);
  if (somme("contre") !== d.contre) erreurs.push(`contre : groupes ${somme("contre")} ≠ scrutin ${d.contre}`);
  if (somme("abstention") !== d.abstentions) erreurs.push(`abstentions : groupes ${somme("abstention")} ≠ scrutin ${d.abstentions}`);
  return erreurs;
}

export function carrouselVote(d: DonneesVote, dossier: string): Slide[] {
  const erreurs = controlerVote(d);
  if (erreurs.length) throw new Error(`Scrutin ${d.numero} incohérent : ${erreurs.join(" ; ")}`);
  const p = PALETTES.vert;
  const rubrique = "Vote · Assemblée nationale";
  const verdict = d.adopte ? "Adopté" : "Rejeté";
  const fabriques: ((i: number, n: number) => string)[] = [];

  fabriques.push((i, n) => cadre(p, "pleine", `${entete(dossier, rubrique, i, n)}
    <div class="corps" style="margin-top:38px">
      <div class="titre geant" data-ajuster style="font-size:150px">L’Assemblée<br>a voté.<br><span class="surligne">${verdict}</span></div>
      <div class="sous" style="margin-top:26px;font-size:44px" data-ajuster>${echapper(d.titreCourt)}</div>
      <div class="petit" style="margin-top:14px">${echapper(d.date)}${d.etape ? ` · ${echapper(d.etape)}` : ""}</div>
    </div>
    <div class="fond-image"><img class="batiment" src="${dossier}/assemblee.png" alt=""></div>
    <div class="bande">lapolitiquecestsimple.fr</div>`));

  if (d.mesures.length) fabriques.push((i, n) => cadre(p, "", `${entete(dossier, rubrique, i, n)}
    <div class="corps" style="margin-top:34px">
      <div class="etiquette">En clair</div>
      <div class="titre grand" data-ajuster>Ce que prévoit<br>le texte.</div>
      ${pointsHtml(d.mesures)}
      <div class="bas"><div class="bouton">Le texte décrypté sur notre site ${FLECHE}</div><div class="site">lapolitiquecestsimple.fr</div></div>
    </div>`));

  fabriques.push((i, n) => cadre(p, "", `${entete(dossier, rubrique, i, n)}
    <div class="corps" style="margin-top:38px">
      <div class="titre" style="font-size:120px">Le résultat<br>du scrutin.</div>
      <div style="margin-top:24px">
        <div class="ligne-res" style="color:#0B7A4B"><div class="n">${nombre(d.pour)}</div><div class="l">Pour</div></div>
        <div class="ligne-res" style="color:#E01E2B"><div class="n">${nombre(d.contre)}</div><div class="l">Contre</div></div>
        <div class="ligne-res" style="color:#3B4252"><div class="n">${nombre(d.abstentions)}</div><div class="l">Abstentions</div></div>
      </div>
      <div class="petit" style="margin-top:26px;color:#27304f">Non-votants : ${nombre(d.nonVotants)} · Scrutin n° ${d.numero}</div>
      <div class="bas"><div class="bouton">Le scrutin complet sur notre site ${FLECHE}</div><div class="site">lapolitiquecestsimple.fr</div></div>
    </div>`));

  fabriques.push((i, n) => cadre(p, "", `${entete(dossier, rubrique, i, n)}
    <div class="corps" style="margin-top:28px">
      <div class="titre" style="font-size:120px">Qui a voté quoi ?</div>
      <div class="sous" style="font-size:36px;margin-top:8px">Par groupe parlementaire, en nombre de députés.</div>
      <table><thead><tr><th>Groupe</th><th style="background:#0B7A4B;width:150px">Pour</th><th style="background:#E01E2B;width:150px">Contre</th><th style="background:#8B93A5;width:150px">Abst.</th></tr></thead>
      <tbody>${d.groupes.map(g => {
        const max = Math.max(g.pour, g.contre, g.abstention);
        const cellule = (v: number) => `<td class="${v === max && v > 0 ? "maj" : ""}">${v || "–"}</td>`;
        return `<tr><td>${echapper(g.nom)}</td>${cellule(g.pour)}${cellule(g.contre)}${cellule(g.abstention)}</tr>`;
      }).join("")}</tbody></table>
      <div class="bas"><div class="note">Un groupe ne vote pas toujours d'un seul bloc :<br>le vote de ton élu est sur notre site.</div><div class="site">lapolitiquecestsimple.fr</div></div>
    </div>`));

  if (d.suite?.length) fabriques.push((i, n) => cadre(p, "", `${entete(dossier, rubrique, i, n)}
    <div class="corps" style="margin-top:38px">
      <div class="titre grand">Et maintenant ?</div>
      ${pointsHtml(d.suite!)}
      <div class="encart">Un vote ne signifie pas toujours une application immédiate.</div>
      <div class="bas"><div class="bouton">La suite sur notre site ${FLECHE}</div><div class="site">lapolitiquecestsimple.fr</div></div>
    </div>`));

  fabriques.push((i, n) => cadre(p, "pleine", `${entete(dossier, rubrique, i, n)}
    <div class="corps" style="margin-top:44px">
      <div class="titre geant" data-ajuster style="font-size:176px">Comprendre.<br>Vérifier.<br>Suivre.</div>
      <div class="sous" style="margin-top:44px;font-weight:600">Le scrutin et les sources :</div>
      <div class="liens">
        <div class="lien">${LIEN_EXT} Scrutin public n° ${d.numero}, assemblee-nationale.fr</div>
        ${d.lienDossier ? `<div class="lien">${LIEN_EXT} Dossier législatif</div>` : ""}
      </div>
      <div class="bas" style="display:block;border-top:2px solid rgba(255,255,255,.4)">
        <div class="sous" style="font-size:36px">Retrouvez le décryptage sur</div>
        <div class="fin-site">lapolitiquecestsimple.fr<span class="clair">.</span></div>
      </div>
    </div>`));

  return fabriques.map((f, i) => ({ nom: `vote-${String(i + 1).padStart(2, "0")}`, html: f(i + 1, fabriques.length) }));
}

// ─── Chiffre officiel ─────────────────────────────────────────────────────────

export type DonneesChiffre = {
  rubrique: string;
  accroche: string;
  valeur: string;
  sousTitre: string;
  comparaison: { periode: string; valeur: string }[];
  explications: string[];
  source: string;
  lienSource: string;
  palette?: keyof typeof PALETTES;
};

export function carrouselChiffre(d: DonneesChiffre, dossier: string): Slide[] {
  const p = PALETTES[d.palette ?? "cobalt"];
  const n = 3;
  return [
    cadre(p, "pleine", `${entete(dossier, d.rubrique, 1, n)}
      <div class="corps" style="margin-top:60px">
        <div class="titre geant" data-ajuster>${echapper(d.accroche)}</div>
        <div class="chiffre clair" data-ajuster style="margin-top:34px">${echapper(d.valeur)}</div>
        <div class="sous" style="margin-top:34px">${echapper(d.sousTitre)}</div>
        <div class="bas"><div class="sous" style="font-size:38px"><b>Les chiffres,</b> sans commentaire.</div>${FLECHE}</div>
      </div>`),
    cadre(p, "", `${entete(dossier, d.rubrique, 2, n)}
      <div class="corps" style="margin-top:34px">
        <div class="etiquette">En clair</div>
        <div class="titre grand">Ce que dit<br>le chiffre.</div>
        <div class="comparaison">${d.comparaison.map(c => `<div><div class="p">${echapper(c.periode)}</div><div class="titre" data-ajuster style="font-size:135px;color:var(--accent)">${echapper(c.valeur)}</div></div>`).join("")}</div>
        <div style="margin-top:46px;display:flex;flex-direction:column;gap:20px">${d.explications.map(e => `<div class="sous" style="font-size:44px;color:#27304f">${echapper(e)}</div>`).join("")}</div>
        <div class="bas" style="display:block">
          <div class="source"><b>Source :</b> ${echapper(d.source)}</div>
        </div>
      </div>`),
    cadre(p, "pleine", `${entete(dossier, d.rubrique, 3, n)}
      <div class="corps" style="margin-top:44px">
        <div class="titre geant" data-ajuster style="font-size:176px">Comprendre.<br>Vérifier.<br>Suivre.</div>
        <div class="sous" style="margin-top:44px;font-weight:600">La source :</div>
        <div class="liens"><div class="lien">${LIEN_EXT} ${echapper(d.source)}</div></div>
        <div class="bas" style="display:block;border-top:2px solid rgba(255,255,255,.4)">
          <div class="sous" style="font-size:36px">Retrouvez les explications sur</div>
          <div class="fin-site">lapolitiquecestsimple.fr<span class="clair">.</span></div>
        </div>
      </div>`),
  ].map((html, i) => ({ nom: `chiffre-${String(i + 1).padStart(2, "0")}`, html }));
}

// ─── Visuel LinkedIn « Le brief » ─────────────────────────────────────────────

export type DonneesBrief = {
  titre: string;
  sousTitre: string;
  colonnes: { valeur: string; texte: string }[];
  palette?: keyof typeof PALETTES;
};

export function visuelBrief(d: DonneesBrief): Slide {
  const p = PALETTES[d.palette ?? "cobalt"];
  return {
    nom: "linkedin-brief",
    html: cadre(p, "li", `<div class="tete"><div class="lpcs">LPCS</div><div class="sep"></div><div class="brief">LE BRIEF</div></div>
      <div class="pilier">
        <div class="barre"><div class="titre" style="font-size:150px" data-ajuster>${echapper(d.titre)}</div>
        <div class="sous" style="margin-top:26px;font-weight:400">${echapper(d.sousTitre)}</div></div>
        <div class="trois">${d.colonnes.map(c => `<div><div class="v">${echapper(c.valeur)}</div><div class="t">${echapper(c.texte)}</div></div>`).join("")}</div>
      </div>
      <div class="pied"><span>La politique, c’est simple<span class="clair" style="color:var(--clair)">.</span></span><span>lapolitiquecestsimple.fr</span></div>`),
  };
}


// ─── Idée de post (actualité, programme, texte de loi…) ───────────────────────

export function slideIdee(d: { rubrique: string; accroche: string; source: string; palette?: keyof typeof PALETTES }, pages: string[][], dossier: string): Slide[] {
  const p = PALETTES[d.palette ?? "rose"];
  const n = pages.length + 2;
  return [
    cadre(p, "pleine", `${entete(dossier, d.rubrique, 1, n)}
      <div class="corps" style="margin-top:60px">
        <div class="titre geant" data-ajuster>${echapper(d.accroche)}</div>
        <div class="filet"></div>
        <div class="bas"><div class="sous" style="font-size:38px"><b>Les faits,</b> en clair.</div>${FLECHE}</div>
      </div>`),
    ...pages.map((page, k) => cadre(p, "", `${entete(dossier, d.rubrique, k + 2, n)}
      <div class="corps" style="margin-top:34px">
        <div class="etiquette">En clair</div>
        <div class="titre" style="font-size:120px">Ce qu’il faut savoir.</div>
        <div data-ajuster style="font-size:50px;flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center">${page.map((t, i) => `<div class="point" style="padding:24px 0"><div class="num" style="font-size:100px;min-width:96px">${String(i + 1 + k * 2).padStart(2, "0")}</div><div class="txt" style="font-weight:600;line-height:1.18">${echapper(t)}</div></div>`).join("")}</div>
        <div class="bas" style="display:block"><div class="source"><b>Source :</b> ${echapper(d.source)}</div></div>
      </div>`)),
    cadre(p, "pleine", `${entete(dossier, d.rubrique, n, n)}
      <div class="corps" style="margin-top:44px">
        <div class="titre geant" data-ajuster style="font-size:176px">Comprendre.<br>Vérifier.<br>Suivre.</div>
        <div class="sous" style="margin-top:44px;font-weight:600">La source :</div>
        <div class="liens"><div class="lien">${LIEN_EXT} ${echapper(d.source)}</div></div>
        <div class="bas" style="display:block;border-top:2px solid rgba(255,255,255,.4)">
          <div class="sous" style="font-size:36px">Retrouvez les explications sur</div>
          <div class="fin-site">lapolitiquecestsimple.fr<span class="clair">.</span></div>
        </div>
      </div>`),
  ].map((html, i) => ({ nom: `idee-${String(i + 1).padStart(2, "0")}`, html }));
}
