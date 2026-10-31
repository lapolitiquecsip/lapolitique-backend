import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { CSS, HAUTEUR, LARGEUR, type Slide } from "./gabarits.js";

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
  for (const t of slide.querySelectorAll("[data-ajuster]")) {
    let taille = parseFloat(getComputedStyle(t).fontSize);
    while (taille > 40 && deborde()) {
      taille -= 2;
      t.style.fontSize = taille + "px";
    }
  }
  return !deborde();
})()`;

/** Photographie chaque slide en PNG ; s'arrête si un texte sort du cadre plutôt que de publier un visuel coupé. */
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
      const png = join(sortie, `${s.nom}.png`);
      await page.locator(".slide").screenshot({ path: png });
      fichiers.push(png);
    }
  } finally {
    await navigateur.close();
  }
  return fichiers;
}
