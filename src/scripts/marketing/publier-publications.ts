import "dotenv/config";
import { chromium } from "playwright";
import { supabase } from "../../config/supabase.js";
import { lireTexte, notion, notionActif } from "../../lib/notion.js";
import { instagram, lireJson } from "../../lib/instagram.js";

/**
 * Publie ce qui a été VALIDÉ À LA MAIN dans Notion Publications : statut « Validé », date prévue atteinte
 * ou vide. Le texte envoyé est celui de la fiche au moment de l'envoi, donc les corrections comptent.
 * Le lien de chaque réseau est noté aussitôt : une fiche relancée ne repart pas deux fois au même endroit.
 * « Compte destinataire » peut restreindre à Instagram ou LinkedIn ; vide = les deux.
 * Une plateforme sans clé est simplement sautée. `--essai` liste sans rien envoyer.
 * `--verifier` contrôle le jeton Instagram (compte, type, quota du jour) sans rien publier.
 *
 * Jeton Instagram : table jetons_reseaux (sinon secret INSTAGRAM_ACCESS_TOKEN). Depuis le 25/11/2026,
 * jeton permanent d'utilisateur système Meta (graph.facebook.com) ; voir src/lib/instagram.ts.
 */
const ESSAI = process.argv.includes("--essai");
const VERIFIER = process.argv.includes("--verifier");
const BASE = process.env.NOTION_PUBLICATIONS_ID ?? "2a521d9901334926805216c885ac0499";
const LI_VERSION = process.env.LINKEDIN_VERSION ?? "202610";

const json = lireJson;

/** Vérifie le jeton (compte, quota du jour) ; voir src/lib/instagram.ts pour les deux sortes de jeton. */
async function verifier() {
  const ig = await instagram();
  if (!ig) return null;
  if (VERIFIER) {
    const q = await fetch(`${ig.base}/${ig.compte}/content_publishing_limit?fields=quota_usage,config&access_token=${ig.jeton}`).then(r => json(r, "Instagram quota"));
    console.log(`::notice::Instagram OK : @${ig.pseudo} (jeton ${ig.jeton.startsWith("EAA") ? "permanent" : "60 jours"}), ${q.data?.[0]?.quota_usage ?? 0}/${q.data?.[0]?.config?.quota_total ?? 50} publications sur 24 h.`);
  }
  return ig;
}

const PNG = /\.png($|\?)/i;

/** Instagram ne prend que du JPEG : les visuels PNG des fiches plus anciennes sont convertis à la volée. */
async function enJpeg(urls: string[]): Promise<string[]> {
  if (!urls.some(u => PNG.test(u))) return urls;
  // Chrome est installé d'office sur les machines GitHub : pas de téléchargement de navigateur.
  const navigateur = await chromium.launch({ channel: "chrome" });
  try {
    const page = await navigateur.newPage();
    const sortie: string[] = [];
    for (const u of urls) {
      if (!PNG.test(u)) { sortie.push(u); continue; }
      await page.setContent(`<style>body{margin:0}</style><img src="${u}">`, { waitUntil: "networkidle" });
      const { l, h } = await page.evaluate(() => { const i = document.querySelector("img")!; return { l: i.naturalWidth, h: i.naturalHeight }; });
      if (!l || !h) throw new Error(`visuel illisible : ${u}`);
      await page.setViewportSize({ width: l, height: h });
      const tampon = await page.screenshot({ type: "jpeg", quality: 92, clip: { x: 0, y: 0, width: l, height: h } });
      const chemin = `${decodeURIComponent(new URL(u).pathname).split("/publications/")[1]?.replace(PNG, "") ?? `conversion/${Date.now()}`}.jpg`;
      const { error } = await supabase.storage.from("publications").upload(chemin, tampon, { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error(`Stockage : ${error.message}`);
      sortie.push(supabase.storage.from("publications").getPublicUrl(chemin).data.publicUrl);
    }
    return sortie;
  } finally {
    await navigateur.close();
  }
}

async function publierInstagram(images: string[], legende: string): Promise<{ id: string; permalink: string }> {
  const { compte, jeton, base: IG } = (await instagram())!;
  images = await enJpeg(images.slice(0, 10));
  // Instagram : 2 200 caractères et 30 mots-dièse au plus, sinon refus.
  let n = 0;
  legende = legende.replace(/#[\p{L}\d_]+/gu, m => (++n > 30 ? "" : m)).slice(0, 2200);
  const creer = (p: Record<string, string>) =>
    fetch(`${IG}/${compte}/media`, { method: "POST", body: new URLSearchParams({ ...p, access_token: jeton }) }).then(r => json(r, "Instagram média"));
  const attendre = async (id: string) => {
    for (let i = 0; i < 30; i++) {
      const s = await fetch(`${IG}/${id}?fields=status_code&access_token=${jeton}`).then(r => json(r, "Instagram état"));
      if (s.status_code === "FINISHED") return;
      if (s.status_code === "ERROR") throw new Error(`Instagram a refusé le média ${id}`);
      await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error(`Instagram : média ${id} jamais prêt`);
  };
  if (!images.length) throw new Error("aucun visuel pour Instagram");
  let conteneur: string;
  if (images.length === 1) {
    // Un carrousel exige 2 images au moins : une seule part en publication simple.
    ({ id: conteneur } = await creer({ image_url: images[0], caption: legende }));
  } else {
    const enfants: string[] = [];
    for (const image_url of images) {
      const { id } = await creer({ image_url, is_carousel_item: "true" });
      await attendre(id);
      enfants.push(id);
    }
    ({ id: conteneur } = await creer({ media_type: "CAROUSEL", children: enfants.join(","), caption: legende }));
  }
  await attendre(conteneur);
  const { id } = await fetch(`${IG}/${compte}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: conteneur, access_token: jeton }) }).then(r => json(r, "Instagram publication"));
  const { permalink } = await fetch(`${IG}/${id}?fields=permalink&access_token=${jeton}`).then(r => json(r, "Instagram lien"));
  return { id, permalink };
}

/**
 * Relie le post publié à sa fiche de fabrication (ref:… dans « Sources ») : instagram-stats.ts
 * y ajoutera ses chiffres. Sans gravité si la table manque : la publication est faite.
 */
async function relierFiche(id: string, permalink: string, sources: string, nbVisuels: number) {
  const ref = /ref:[0-9a-f]{16}/.exec(sources)?.[0] ?? null;
  const { data } = ref ? await supabase.from("instagram_fiches").select("fiche").eq("ref", ref).maybeSingle() : { data: null };
  const { error } = await supabase.from("instagram_posts").upsert({
    media_id: id, format: nbVisuels > 1 ? "carrousel" : "image", publie_le: new Date().toISOString(), permalink, ref,
    fiche: { ...(data?.fiche ?? {}), via: "agent" },
  });
  if (error) console.log(`::notice::Post non relié à sa fiche (${error.message}).`);
}

async function publierLinkedIn(images: string[], texte: string): Promise<string> {
  const auteur = process.env.LINKEDIN_AUTHOR_URN!;
  const entetes = { Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`, "Linkedin-Version": LI_VERSION, "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json" };
  const ids: string[] = [];
  for (const url of images) {
    const { value } = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", { method: "POST", headers: entetes, body: JSON.stringify({ initializeUploadRequest: { owner: auteur } }) }).then(r => json(r, "LinkedIn image"));
    const contenu = await fetch(url).then(r => r.arrayBuffer());
    await fetch(value.uploadUrl, { method: "PUT", headers: { Authorization: entetes.Authorization }, body: contenu }).then(r => json(r, "LinkedIn envoi"));
    ids.push(value.image);
  }
  const alt = "Visuel La politique, c'est simple";
  const content = ids.length > 1 ? { multiImage: { images: ids.map(id => ({ id, altText: alt })) } } : { media: { id: ids[0], altText: alt } };
  const r = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST", headers: entetes,
    body: JSON.stringify({
      author: auteur, commentary: texte.replace(/[\\|{}@\[\]()<>*_~]/g, m => `\\${m}`), visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      content, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false,
    }),
  });
  await json(r, "LinkedIn post");
  return `https://www.linkedin.com/feed/update/${r.headers.get("x-restli-id")}/`;
}

async function main() {
  if (VERIFIER) {
    if (!(await verifier())) console.log("::warning::Aucun jeton Instagram : poser le secret INSTAGRAM_ACCESS_TOKEN.");
    return;
  }
  if (!notionActif()) {
    console.log("::notice::NOTION_API_KEY absente : publication en attente.");
    return;
  }
  // Renouvelle le jeton même les jours sans publication ; un jeton invalide fait échouer le job (e-mail GitHub).
  const igActif = Boolean(await instagram());
  const liActif = Boolean(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_AUTHOR_URN);
  const { results } = await notion(`databases/${BASE}/query`, { filter: { and: [{ property: "Statut", select: { equals: "Validé" } }, { property: "Projet", select: { equals: "LPCS" } }] } });
  const maintenant = new Date().toISOString();
  let echecs = 0;

  for (const page of results) {
    const p = page.properties;
    const prevue = p["Date prévue"]?.date?.start;
    if (prevue && prevue > maintenant) continue;
    const titre = lireTexte(p.Sujet);
    const vise = lireTexte(p["Compte destinataire"]).toLowerCase();
    const veutIg = !vise || vise.includes("insta");
    const veutLi = !vise || vise.includes("linkedin");
    const tous: { nom: string; url: string }[] = (p.Visuel?.files ?? []).map((f: any) => ({ nom: f.name, url: f.external?.url ?? f.file?.url })).filter((f: any) => f.url);
    const brief = tous.filter(f => f.nom.startsWith("linkedin")).map(f => f.url);
    const carrousel = tous.filter(f => !f.nom.startsWith("linkedin")).map(f => f.url);
    const liens: Record<string, { url: string }> = {};
    let lienIg = p["Lien publié"]?.url as string | null;
    let lienLi = p["Lien LinkedIn"]?.url as string | null;

    if (ESSAI) {
      console.log(`[essai] ${titre} : ${carrousel.length} visuels, Instagram ${veutIg && !lienIg}, LinkedIn ${veutLi && !lienLi}`);
      continue;
    }
    try {
      if (veutIg && !lienIg && igActif) {
        const publie = await publierInstagram(carrousel, lireTexte(p["Légende Instagram"]));
        lienIg = publie.permalink;
        liens["Lien publié"] = { url: lienIg };
        await relierFiche(publie.id, publie.permalink, lireTexte(p.Sources), carrousel.length);
      }
      if (veutLi && !lienLi && liActif) {
        lienLi = await publierLinkedIn(brief.length ? brief : carrousel.slice(0, 9), lireTexte(p["Texte LinkedIn"]));
        liens["Lien LinkedIn"] = { url: lienLi };
      }
    } catch (e) {
      echecs++;
      console.log(`::warning::${titre} : ${(e as Error).message}`);
    }
    const fini = (!veutIg || lienIg) && (!veutLi || lienLi);
    if (Object.keys(liens).length || fini) {
      await notion(`pages/${page.id}`, { properties: { ...liens, ...(fini ? { Statut: { select: { name: "Publié" } } } : {}) } }, "PATCH");
      console.log(`${fini ? "Publié" : "Publié en partie"} : ${titre}`);
    }
  }
  // Un jeton expiré finit ici : le job échoue et GitHub prévient par e-mail.
  if (echecs) process.exit(1);
}

main().then(() => process.exit(0)).catch(e => { console.log(`::error::${String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 500)}`); process.exit(1); });
