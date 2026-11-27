import { chromium } from "playwright";
import { supabase } from "../../config/supabase.js";
import { FONDS_ACTU, PALETTES, type NomFondActu, type NomPalette } from "./charte.js";

/**
 * Les couleurs déjà publiées sur le compte (27/11/2026, consigne d'Hippolyte : « prends en compte les
 * couleurs déjà utilisées… fais dans des couleurs pas encore faites, propose 3/4 couleurs à chaque
 * post »).
 *
 * - Posts publiés par la chaîne : la palette est dans leur fiche.
 * - Posts faits à la main : la couleur du FOND est lue sur leur première image (bande du bord gauche,
 *   médiane des pixels, dans Chromium : aucune dépendance), puis gardée dans instagram_posts.fiche.couleur.
 * - Posts faits à la main pas encore publiés : déclarés dans instagram_fiches (fiche.manuel + palette).
 * Une couleur proche (écart < 60 sur 255) d'une couleur publiée compte comme « déjà faite ».
 */
export type Rvb = [number, number, number];
export type Usage = { couleur: Rvb; date: string };

const hex = (h: string): Rvb => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as Rvb;
const moyenne = (cs: Rvb[]): Rvb => [0, 1, 2].map(k => Math.round(cs.reduce((s, c) => s + c[k], 0) / cs.length)) as Rvb;
export const ecart = (a: Rvb, b: Rvb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Couleur moyenne d'un fond (dégradé compris : moyenne de ses couleurs). */
export const refPalette = (nom: string): Rvb => moyenne((PALETTES[nom as NomPalette].fond.match(/#[0-9A-Fa-f]{6}/g) ?? ["#000000"]).map(hex));
export const refFond = (nom: string): Rvb => hex(FONDS_ACTU[nom as NomFondActu].fond);

/** Couleur du fond de chaque image (null si illisible). */
async function lireFonds(urls: string[], options: { channel?: string } = {}): Promise<(Rvb | null)[]> {
  const nav = await chromium.launch(options.channel ? { channel: options.channel } : {});
  const sortie: (Rvb | null)[] = [];
  try {
    const page = await nav.newPage();
    for (const u of urls) {
      try {
        const r = await fetch(u);
        if (!r.ok) { sortie.push(null); continue; }
        const src = `data:${r.headers.get("content-type") || "image/jpeg"};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
        sortie.push(await page.evaluate(async (s: string) => {
          const img = new Image();
          img.src = s;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          const x = c.getContext("2d")!;
          x.drawImage(img, 0, 0);
          // Bande verticale dans la marge gauche (1 à 3 % de la largeur), de 20 à 80 % de la hauteur.
          const d = x.getImageData(Math.round(c.width * 0.01), Math.round(c.height * 0.2), Math.max(2, Math.round(c.width * 0.02)), Math.round(c.height * 0.6)).data;
          const canaux: number[][] = [[], [], []];
          for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) canaux[k].push(d[i + k]);
          return canaux.map(a => a.sort((p, q) => p - q)[a.length >> 1]) as [number, number, number];
        }, src));
      } catch {
        sortie.push(null);
      }
    }
  } finally {
    await nav.close();
  }
  return sortie;
}

/** Toutes les couleurs déjà publiées (ou déclarées faites à la main), avec leur date. */
export async function couleursPubliees(options: { channel?: string } = {}): Promise<Usage[]> {
  const usages: Usage[] = [];
  const { data } = await supabase.from("instagram_posts").select("media_id, publie_le, miniature, fiche").order("publie_le", { ascending: false }).limit(300);
  const aLire: any[] = [];
  for (const p of (data ?? []) as any[]) {
    const f = p.fiche ?? {};
    if (f.palette && f.palette in PALETTES) usages.push({ couleur: refPalette(f.palette), date: p.publie_le });
    else if (f.fond_actu && f.fond_actu in FONDS_ACTU) usages.push({ couleur: refFond(f.fond_actu), date: p.publie_le });
    else if (Array.isArray(f.couleur)) usages.push({ couleur: f.couleur, date: p.publie_le });
    else if (p.miniature) aLire.push(p);
  }
  if (aLire.length) {
    const lus = await lireFonds(aLire.map(p => p.miniature), options);
    for (const [i, c] of lus.entries()) {
      if (!c) continue;
      usages.push({ couleur: c, date: aLire[i].publie_le });
      await supabase.from("instagram_posts").update({ fiche: { ...(aLire[i].fiche ?? {}), couleur: c } }).eq("media_id", aLire[i].media_id);
    }
  }
  const { data: manuels } = await supabase.from("instagram_fiches").select("fiche, cree_le").eq("fiche->>manuel", "true");
  for (const m of (manuels ?? []) as any[]) {
    if (m.fiche?.palette && m.fiche.palette in PALETTES) usages.push({ couleur: refPalette(m.fiche.palette), date: m.cree_le });
  }
  return usages;
}

/**
 * Les n couleurs à proposer : jamais publiées d'abord, puis les moins récemment publiées. Entre
 * couleurs jamais publiées, l'ordre change chaque jour (pas toujours les mêmes quatre).
 */
export function proposerCouleurs(choix: { nom: string; couleur: Rvb }[], usages: Usage[], n = 4): string[] {
  const jour = new Date().toISOString().slice(0, 10);
  const melange = (s: string) => [...`${s}|${jour}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return choix
    .map(c => ({ nom: c.nom, derniere: usages.filter(u => ecart(u.couleur, c.couleur) < 60).map(u => u.date).sort().pop() ?? "", m: melange(c.nom) }))
    .sort((a, b) => a.derniere.localeCompare(b.derniere) || a.m - b.m)
    .slice(0, n)
    .map(c => c.nom);
}

export const palettesProposees = (usages: Usage[], n = 4) =>
  proposerCouleurs(Object.entries(PALETTES).filter(([, p]) => p.profonde).map(([nom]) => ({ nom, couleur: refPalette(nom) })), usages, n) as NomPalette[];
export const fondsActuProposes = (usages: Usage[], n = 4) =>
  proposerCouleurs(Object.keys(FONDS_ACTU).map(nom => ({ nom, couleur: refFond(nom) })), usages, n) as NomFondActu[];
