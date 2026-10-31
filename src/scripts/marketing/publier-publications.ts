import "dotenv/config";
import { lireTexte, notion, notionActif } from "../../lib/notion.js";

/**
 * Publie ce qui a été VALIDÉ À LA MAIN dans Notion Publications : statut « Validé », date prévue atteinte
 * ou vide. Le texte envoyé est celui de la fiche au moment de l'envoi, donc les corrections comptent.
 * Le lien de chaque réseau est noté aussitôt : une fiche relancée ne repart pas deux fois au même endroit.
 * « Compte destinataire » peut restreindre à Instagram ou LinkedIn ; vide = les deux.
 * Une plateforme sans clé est simplement sautée. `--essai` liste sans rien envoyer.
 */
const ESSAI = process.argv.includes("--essai");
const BASE = process.env.NOTION_PUBLICATIONS_ID ?? "2a521d9901334926805216c885ac0499";
const IG = "https://graph.instagram.com/v23.0";
const LI_VERSION = process.env.LINKEDIN_VERSION ?? "202610";

async function json(r: Response, quoi: string) {
  const t = await r.text();
  if (!r.ok) throw new Error(`${quoi} ${r.status} : ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : {};
}

async function publierInstagram(images: string[], legende: string): Promise<string> {
  const compte = process.env.INSTAGRAM_USER_ID!;
  const jeton = process.env.INSTAGRAM_ACCESS_TOKEN!;
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
  const enfants: string[] = [];
  for (const image_url of images.slice(0, 10)) {
    const { id } = await creer({ image_url, is_carousel_item: "true" });
    await attendre(id);
    enfants.push(id);
  }
  const { id: conteneur } = await creer({ media_type: "CAROUSEL", children: enfants.join(","), caption: legende });
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
  if (!notionActif()) {
    console.log("::notice::NOTION_API_KEY absente : publication en attente.");
    return;
  }
  const igActif = Boolean(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_USER_ID);
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

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
