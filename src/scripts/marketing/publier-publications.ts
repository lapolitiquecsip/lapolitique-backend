import "dotenv/config";
import { chromium } from "playwright";
import { supabase } from "../../config/supabase.js";
import { lireTexte, notion, notionActif } from "../../lib/notion.js";

/**
 * Publie ce qui a été VALIDÉ À LA MAIN dans Notion Publications : statut « Validé », date prévue atteinte
 * ou vide. Le texte envoyé est celui de la fiche au moment de l'envoi, donc les corrections comptent.
 * Le lien de chaque réseau est noté aussitôt : une fiche relancée ne repart pas deux fois au même endroit.
 * « Compte destinataire » peut restreindre à Instagram ou LinkedIn ; vide = les deux.
 * Une plateforme sans clé est simplement sautée. `--essai` liste sans rien envoyer.
 * `--verifier` contrôle le jeton Instagram (compte, type, quota du jour) sans rien publier.
 *
 * Jeton Instagram : posé une fois dans le secret INSTAGRAM_ACCESS_TOKEN (60 jours), renouvelé ici chaque
 * semaine et rangé dans la table jetons_reseaux, qui prime ensuite sur le secret.
 */
const ESSAI = process.argv.includes("--essai");
const VERIFIER = process.argv.includes("--verifier");
const BASE = process.env.NOTION_PUBLICATIONS_ID ?? "2a521d9901334926805216c885ac0499";
const IG = "https://graph.instagram.com/v23.0";
const LI_VERSION = process.env.LINKEDIN_VERSION ?? "202610";

async function json(r: Response, quoi: string) {
  const t = await r.text();
  if (!r.ok) throw new Error(`${quoi} ${r.status} : ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : {};
}

let ig: { jeton: string; compte: string } | null = null;

/** Jeton le plus récent (table, sinon secret), renouvelé s'il a plus de 7 jours ; compte lu sur /me. */
async function instagram(): Promise<{ jeton: string; compte: string } | null> {
  if (ig) return ig;
  const { data: rangee } = await supabase.from("jetons_reseaux").select("jeton, maj_le").eq("plateforme", "instagram").maybeSingle();
  const secret = process.env.INSTAGRAM_ACCESS_TOKEN;
  let jeton = rangee?.jeton ?? secret;
  if (!jeton) return null;
  let maj = rangee?.maj_le ? new Date(rangee.maj_le).getTime() : 0;
  const essayer = async (j: string) => fetch(`${IG}/me?fields=user_id,username,account_type&access_token=${j}`).then(r => json(r, "Instagram compte"));
  let moi: any;
  try { moi = await essayer(jeton); } catch (e) {
    // Jeton de la table mort mais secret remplacé à la main depuis : on repart du secret.
    if (!secret || jeton === secret) throw e;
    jeton = secret; maj = 0; moi = await essayer(jeton);
  }
  if (Date.now() - maj > 7 * 86400_000) {
    try {
      const n = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${jeton}`).then(r => json(r, "Instagram renouvellement"));
      jeton = n.access_token;
      const { error } = await supabase.from("jetons_reseaux").upsert({ plateforme: "instagram", jeton, compte: moi.username, expire_le: new Date(Date.now() + n.expires_in * 1000).toISOString(), maj_le: new Date().toISOString() });
      if (error) console.log(`::warning::Jeton Instagram renouvelé mais pas rangé : ${error.message}`);
      else console.log(`Jeton Instagram renouvelé (expire dans ${Math.round(n.expires_in / 86400)} jours).`);
    } catch (e) {
      // Un jeton de moins de 24 h refuse le renouvellement : sans gravité, on réessaiera.
      console.log(`::notice::${(e as Error).message}`);
    }
  }
  ig = { jeton, compte: process.env.INSTAGRAM_USER_ID || String(moi.user_id ?? moi.id) };
  if (VERIFIER) {
    const q = await fetch(`${IG}/${ig.compte}/content_publishing_limit?fields=quota_usage,config&access_token=${jeton}`).then(r => json(r, "Instagram quota"));
    console.log(`::notice::Instagram OK : @${moi.username} (${moi.account_type}), ${q.data?.[0]?.quota_usage ?? 0}/${q.data?.[0]?.config?.quota_total ?? 50} publications sur 24 h.`);
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

async function publierInstagram(images: string[], legende: string): Promise<string> {
  const { compte, jeton } = (await instagram())!;
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
  return permalink;
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
    if (!(await instagram())) console.log("::warning::Aucun jeton Instagram : poser le secret INSTAGRAM_ACCESS_TOKEN.");
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
        lienIg = await publierInstagram(carrousel, lireTexte(p["Légende Instagram"]));
        liens["Lien publié"] = { url: lienIg };
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
