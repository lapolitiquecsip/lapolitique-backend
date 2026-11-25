import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { CSS, HAUTEUR, LARGEUR, type Slide } from "./gabarits.js";
import { CSS_CHARTE, FORMAT, type Page } from "./charte.js";

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

// ─── Charte v2 (Rose, 25/11/2026) : formats carré 4:5 et story 9:16 ──────────────

/**
 * Charte v2 : seuls les TEXTES comptent (portraits et objets dépassent exprès du cadre). Les blocs
 * [data-ajuster] rétrécissent ensemble jusqu'à ce que chaque texte tienne dans la slide et que le
 * corps ne déborde plus ; sinon le rendu est refusé (renvoie la liste des textes fautifs).
 */
const AJUSTER_CHARTE = `(() => {
  const slide = document.querySelector(".slide");
  const S = slide.getBoundingClientRect();
  const corps = slide.querySelector(".corps");
  const textes = [...slide.querySelectorAll(".corps *, .pied *")].filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
  const fautifs = () => {
    const f = textes.filter(e => { const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect();
      return b.width && (b.right > S.right - 28 || b.left < S.left + 20 || b.bottom > S.bottom - 14); });
    if (corps && corps.scrollHeight > corps.clientHeight + 1) f.push(corps);
    return f;
  };
  const blocs = [...slide.querySelectorAll("[data-ajuster]")];
  for (let k = 0; k < 50 && fautifs().length; k++) {
    for (const t of blocs) t.style.fontSize = Math.max(26, parseFloat(getComputedStyle(t).fontSize) * 0.97) + "px";
  }
  return fautifs().map(e => (e.textContent || "").trim().slice(0, 60));
})()`;

/** Photographie les pages de la charte v2 (src/lib/visuels/charte.ts) en JPEG, chacune à son format. */
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
      await page.locator(".slide").screenshot({ path: jpg, type: "jpeg", quality: 92 });
      await page.close();
      if (fautifs.length && !options.tolerer) throw new Error(`Le texte déborde du visuel ${p.nom} : ${fautifs.join(" | ")}`);
      if (fautifs.length) console.log(`::warning::${p.nom} déborde : ${fautifs.join(" | ")}`);
      fichiers.push(jpg);
    }
  } finally {
    await navigateur.close();
  }
  return fichiers;
}

/**
 * Capture d'une page du site, vue sur téléphone (390 px, rendu ×2,4), pour la dernière slide.
 * Bandeaux de cookies et d'abonnement masqués ; `selecteur` vise une partie de la page.
 */
export async function captureSite(url: string, fichier: string, options: { channel?: string; hauteur?: number; selecteur?: string } = {}): Promise<string> {
  const navigateur = await chromium.launch(options.channel ? { channel: options.channel } : {});
  try {
    const page = await navigateur.newPage({ viewport: { width: 390, height: options.hauteur ?? 620 }, deviceScaleFactor: 2.4, colorScheme: "light" });
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    // Seulement le bandeau de cookies : la fiche d'un candidat s'ouvre justement dans une fenêtre.
    await page.addStyleTag({ content: "#cookie-banner,[class*=CookieBanner],[class*=cookie-banner],[data-cookie]{display:none!important}" });
    await page.waitForTimeout(2500);
    // Amène en haut de l'écran la partie voulue (un sélecteur, ou un texte comme le nom du candidat).
    const cible = options.selecteur ? page.locator(options.selecteur).first() : null;
    if (cible) {
      await cible.evaluate((e: Element) => { const y = e.getBoundingClientRect().top + window.scrollY - 90; window.scrollTo(0, Math.max(0, y)); }).catch(() => null);
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: fichier, type: "jpeg", quality: 90 });
    return fichier;
  } finally {
    await navigateur.close();
  }
}
