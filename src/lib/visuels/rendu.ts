import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { CSS, HAUTEUR, LARGEUR, type Slide } from "./gabarits.js";
import { carrouselProgramme, CSS_CHARTE, FORMAT, type DonneesProgramme, type Page } from "./charte.js";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const DOSSIER_ASSETS = pathToFileURL(join(RACINE, "assets/visuels")).href;

/** Réduit les titres jusqu'à ce que la slide tienne, puis refuse ce qui déborde encore. */
const AJUSTER = `(() => {
  const slide = document.querySelector(".slide");
  const corps = slide.querySelector(".corps") || slide;
  // Un titre peut sortir de sa boîte sans créer de défilement : on mesure aussi le texte réel.
  const horsMarge = () => [...slide.querySelectorAll(".titre, .sous, .l, .lien, .fin-site, .num, .chiffre")].some(e => {
    const r = document.createRange();
    r.selectNodeContents(e);
    return r.getBoundingClientRect().right > slide.clientWidth - 36;
  });
  const deborde = () =>
    slide.scrollHeight > slide.clientHeight + 1 || slide.scrollWidth > slide.clientWidth + 1 || corps.scrollHeight > corps.clientHeight + 1 || horsMarge();
  // Tout rétrécit ensemble, pour que le plus long texte ne vide pas un titre qui n'y est pour rien.
  const blocs = [...slide.querySelectorAll("[data-ajuster]")];
  for (let k = 0; k < 40 && deborde(); k++) {
    for (const t of blocs) t.style.fontSize = Math.max(30, parseFloat(getComputedStyle(t).fontSize) * 0.97) + "px";
  }
  return !deborde();
})()`;

/** Photographie chaque slide en JPEG (seul format accepté par l'API de publication d'Instagram) ; s'arrête si un texte sort du cadre plutôt que de publier un visuel coupé. */
export async function rendreSlides(slides: Slide[], sortie: string, options: { channel?: string } = {}): Promise<string[]> {
  mkdirSync(sortie, { recursive: true });
  const navigateur = await chromium.launch(options.channel ? { channel: options.channel } : {});
  const fichiers: string[] = [];
  try {
    const page = await navigateur.newPage({ viewport: { width: LARGEUR, height: HAUTEUR } });
    for (const s of slides) {
      const tampon = join(sortie, `_${s.nom}.html`);
      writeFileSync(tampon, `<!doctype html><meta charset="utf-8"><style>${CSS(DOSSIER_ASSETS)}</style>${s.html}`);
      await page.goto(pathToFileURL(tampon).href, { waitUntil: "networkidle" });
      await page.evaluate("document.fonts.ready");
      if (!(await page.evaluate(AJUSTER))) throw new Error(`Le texte déborde du visuel ${s.nom}`);
      const jpg = join(sortie, `${s.nom}.jpg`);
      await page.locator(".slide").screenshot({ path: jpg, type: "jpeg", quality: 92 });
      fichiers.push(jpg);
    }
  } finally {
    await navigateur.close();
  }
  return fichiers;
}

// ─── Charte v3 (Rose, 26/11/2026) : formats 4:5 et 9:16 ─────────────────────────

/**
 * Seuls les TEXTES comptent (portraits et objets peuvent aller au bord). 1) Les blocs [data-ajuster]
 * rétrécissent ensemble, jamais sous 30 px, jusqu'à ce que chaque texte tienne. 2) Un objet qui
 * chevauche un texte est réduit (jusqu'à 200 px), puis retiré avec ses traits (« si l'objet gêne la
 * lecture, réduis-le ou retire-le »). Renvoie les textes qui débordent encore (le rendu est alors
 * refusé : l'appelant répartit sur deux slides).
 */
const AJUSTER_CHARTE = `(() => {
  const slide = document.querySelector(".slide");
  const S = slide.getBoundingClientRect();
  const corps = slide.querySelector(".corps");
  const textes = [...slide.querySelectorAll(".corps *, .pied *")].filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
  const boite = e => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect(); };
  const fautifs = () => {
    const f = textes.filter(e => { const b = boite(e); return b.width && (b.right > S.right - 28 || b.left < S.left + 20 || b.bottom > S.bottom - 14); });
    if (corps && corps.scrollHeight > corps.clientHeight + 1) f.push(corps);
    return f;
  };
  const blocs = [...slide.querySelectorAll("[data-ajuster]")];
  for (let k = 0; k < 60 && fautifs().length; k++) {
    for (const t of blocs) t.style.fontSize = Math.max(30, parseFloat(getComputedStyle(t).fontSize) * 0.97) + "px";
  }
  const touche = (a, b) => !(a.right < b.left + 6 || a.left > b.right - 6 || a.bottom < b.top + 6 || a.top > b.bottom - 6);
  for (const o of slide.querySelectorAll(".objet")) {
    const gene = () => textes.some(e => { const b = boite(e); return b.width && touche(b, o.getBoundingClientRect()); });
    for (let k = 0; k < 12 && gene() && o.getBoundingClientRect().width > 200; k++) o.style.width = (o.getBoundingClientRect().width * 0.9) + "px";
    if (gene()) { o.remove(); slide.querySelectorAll(".eclat-objet").forEach(x => x.remove()); continue; }
    // Les trois traits se posent au-dessus de l'objet, là où il a fini ; retirés s'ils touchent un texte.
    for (const e of slide.querySelectorAll(".eclat-objet")) {
      const b = o.getBoundingClientRect();
      e.style.left = (b.left - S.left + b.width * 0.3) + "px"; e.style.top = (b.top - S.top - 70) + "px";
      e.style.right = "auto"; e.style.bottom = "auto";
      if (textes.some(t => { const r = boite(t); return r.width && touche(r, e.getBoundingClientRect()); })) e.remove();
    }
  }
  // Image du coin (actu) : sa partie pleine suit un bord en diagonale, d'où les 4 zones. Si un texte la
  // touche : l'image rétrécit (jusqu'à ~60 %), puis les textes un peu, sinon elle est retirée.
  for (const c of slide.querySelectorAll(".coin")) {
    const zones = () => { const b = c.getBoundingClientRect(); return [[0, .60], [.24, .38], [.48, .2], [.74, .06]].map(([x, y]) => ({ left: b.left + x * b.width, top: b.top + y * b.height, right: b.right, bottom: b.bottom })); };
    const gene = () => textes.some(e => { const b = boite(e); return b.width && zones().some(z => touche(b, z)); });
    for (let k = 0; k < 8 && gene(); k++) { const b = c.getBoundingClientRect(); c.style.width = (b.width * 0.94) + "px"; c.style.height = (b.height * 0.94) + "px"; }
    for (let k = 0; k < 8 && gene(); k++) for (const t of blocs) t.style.fontSize = Math.max(30, parseFloat(getComputedStyle(t).fontSize) * 0.97) + "px";
    if (gene()) { c.remove(); slide.querySelectorAll(".eclat-coin").forEach(x => x.remove()); continue; }
    for (const e of slide.querySelectorAll(".eclat-coin")) {
      const b = c.getBoundingClientRect();
      e.style.left = (b.left - S.left - 20) + "px"; e.style.top = (b.top - S.top + b.height * 0.30 - 96) + "px";
      e.style.right = "auto"; e.style.bottom = "auto";
      if (textes.some(t => { const r = boite(t); return r.width && touche(r, e.getBoundingClientRect()); })) e.remove();
    }
  }
  return fautifs().map(e => (e.textContent || "").trim().slice(0, 60));
})()`;

/** Photographie les pages de la charte (src/lib/visuels/charte.ts) en JPEG, chacune à son format. */
export async function rendrePages(pages: Page[], sortie: string, options: { channel?: string; tolerer?: boolean } = {}): Promise<string[]> {
  mkdirSync(sortie, { recursive: true });
  const navigateur = await chromium.launch(options.channel ? { channel: options.channel } : {});
  const fichiers: string[] = [];
  try {
    for (const p of pages) {
      const { largeur, hauteur } = FORMAT[p.format];
      const page = await navigateur.newPage({ viewport: { width: largeur, height: hauteur } });
      const tampon = join(sortie, `_${p.nom}.html`);
      writeFileSync(tampon, `<!doctype html><meta charset="utf-8"><style>${CSS_CHARTE(DOSSIER_ASSETS)}</style>${p.html}`);
      await page.goto(pathToFileURL(tampon).href, { waitUntil: "networkidle" });
      await page.evaluate("document.fonts.ready");
      const fautifs = (await page.evaluate(AJUSTER_CHARTE)) as string[];
      const jpg = join(sortie, `${p.nom}.jpg`);
      await page.locator(".slide").screenshot({ path: jpg, type: "jpeg", quality: 94 });
      await page.close();
      if (fautifs.length && !options.tolerer) throw new DebordeError(p.nom, fautifs);
      if (fautifs.length) console.log(`::warning::${p.nom} déborde : ${fautifs.join(" | ")}`);
      fichiers.push(jpg);
    }
  } finally {
    await navigateur.close();
  }
  return fichiers;
}

export class DebordeError extends Error {
  constructor(public slide: string, public textes: string[]) { super(`Le texte déborde du visuel ${slide} : ${textes.join(" | ")}`); }
}

/** Carrousel programme : 3 mesures par slide ; si un texte ne tient pas même à 30 px, 2 par slide. */
export async function rendreProgramme(d: DonneesProgramme, sortie: string, options: { channel?: string } = {}): Promise<string[]> {
  try {
    return await rendrePages(carrouselProgramme({ ...d, parSlide: 3 }), sortie, options);
  } catch (e) {
    if (!(e instanceof DebordeError)) throw e;
    console.log(`::notice::${e.message} — réparti sur deux slides.`);
    return rendrePages(carrouselProgramme({ ...d, parSlide: 2 }), sortie, options);
  }
}

/**
 * Captures d'une page du site vue sur téléphone (390 px, rendu ×2,4) pour la dernière slide : le
 * haut de la page (ou de la fiche, qui s'ouvre dans une fenêtre), puis chaque rubrique demandée
 * (« Programme », « Parcours »…) amenée en haut de l'écran. Une rubrique introuvable est sautée.
 */
export async function capturesSite(url: string, dossier: string, rubriques: string[] = [], options: { channel?: string; hauteur?: number } = {}): Promise<string[]> {
  mkdirSync(dossier, { recursive: true });
  const navigateur = await chromium.launch(options.channel ? { channel: options.channel } : {});
  const fichiers: string[] = [];
  try {
    const page = await navigateur.newPage({ viewport: { width: 390, height: options.hauteur ?? 640 }, deviceScaleFactor: 2.4, colorScheme: "light" });
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    // Seulement le bandeau de cookies : la fiche d'un candidat s'ouvre justement dans une fenêtre.
    await page.addStyleTag({ content: "#cookie-banner,[class*=CookieBanner],[class*=cookie-banner],[data-cookie]{display:none!important}" });
    await page.waitForTimeout(2500);
    const principal = join(dossier, "capture-1.jpg");
    await page.screenshot({ path: principal, type: "jpeg", quality: 90 });
    fichiers.push(principal);
    for (const [i, r] of rubriques.entries()) {
      const zone = (await page.locator("[role=dialog]").count()) ? page.locator("[role=dialog]") : page.locator("body");
      const titre = zone.getByRole("heading", { name: new RegExp(r, "i") }).first();
      const cible = (await titre.count()) ? titre : zone.getByText(new RegExp(`^\s*${r}`, "i")).first();
      if (!(await cible.count())) continue;
      await cible.evaluate((e: Element) => e.scrollIntoView({ block: "start" })).catch(() => null);
      await page.waitForTimeout(700);
      const f = join(dossier, `capture-${i + 2}.jpg`);
      await page.screenshot({ path: f, type: "jpeg", quality: 90 });
      fichiers.push(f);
    }
    return fichiers;
  } finally {
    await navigateur.close();
  }
}
