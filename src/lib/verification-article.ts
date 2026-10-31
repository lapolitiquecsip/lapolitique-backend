import { executer, plafondAtteint, type ResultatAgentik } from "./agentik.js";
import { coutUsage, noter } from "./budget-claude.js";
import { resilientDeepSeek } from "./deepseek-client.js";

/**
 * Contrôle d'un article de presse AVANT publication (30/10/2026).
 *
 * Origine : un article WanSquare du 14/12/2016 s'affichait au 22/10/2026, avec un résumé écrit sans
 * lire l'article (l'IA n'avait que le titre et l'extrait de Google Actualités, dont la date est celle
 * de sa dernière indexation). Désormais, un article n'est publié que s'il passe TOUS ces contrôles :
 *   1. média reconnu (liste ci-dessous, tous bords : ni presse people, ni agrégateur, ni site de parti) ;
 *   2. date lue DANS l'article, de moins de `joursMax` jours — pas de date trouvée, pas de publication ;
 *   3. article réellement lu, et le nom de la personne y figure ;
 *   4. résumé écrit à partir du texte, avec une citation qu'on retrouve mot pour mot dans le texte,
 *      et aucun chiffre absent du texte ;
 *   5. annonce sensible (candidature, retrait, ralliement, justice) : confirmée par un second média
 *      reconnu.
 * Dans le doute, on ne publie pas.
 */
export const MEDIAS_RECONNUS: Record<string, string> = {
  "lemonde.fr": "Le Monde", "lefigaro.fr": "Le Figaro", "liberation.fr": "Libération", "lesechos.fr": "Les Echos",
  "leparisien.fr": "Le Parisien", "francetvinfo.fr": "franceinfo", "franceinfo.fr": "franceinfo", "radiofrance.fr": "Radio France",
  "20minutes.fr": "20 Minutes", "bfmtv.com": "BFMTV", "tf1info.fr": "TF1 Info", "lci.fr": "LCI", "europe1.fr": "Europe 1",
  "rtl.fr": "RTL", "cnews.fr": "CNews", "nouvelobs.com": "L'Obs", "lexpress.fr": "L'Express", "lepoint.fr": "Le Point",
  "lopinion.fr": "L'Opinion", "marianne.net": "Marianne", "mediapart.fr": "Mediapart", "lejdd.fr": "Le JDD",
  "valeursactuelles.com": "Valeurs actuelles", "humanite.fr": "L'Humanité", "la-croix.com": "La Croix",
  "huffingtonpost.fr": "Le HuffPost", "publicsenat.fr": "Public Sénat", "lcp.fr": "LCP", "france24.com": "France 24", "rfi.fr": "RFI",
  "latribune.fr": "La Tribune", "challenges.fr": "Challenges", "ouest-france.fr": "Ouest-France", "sudouest.fr": "Sud Ouest",
  "ladepeche.fr": "La Dépêche", "midilibre.fr": "Midi Libre", "leprogres.fr": "Le Progrès", "ledauphine.com": "Le Dauphiné",
  "dna.fr": "DNA", "nicematin.com": "Nice-Matin", "lavoixdunord.fr": "La Voix du Nord", "letelegramme.fr": "Le Télégramme",
  "lamontagne.fr": "La Montagne", "ici.fr": "ici", "vie-publique.fr": "Vie publique",
  "lindependant.fr": "L'Indépendant", "lanouvellerepublique.fr": "La Nouvelle République", "lejsl.com": "Le JSL",
  "estrepublicain.fr": "L'Est Républicain", "republicain-lorrain.fr": "Le Républicain Lorrain", "lalsace.fr": "L'Alsace",
  "bienpublic.com": "Le Bien Public", "courrier-picard.fr": "Courrier picard", "paris-normandie.fr": "Paris-Normandie",
  "lunion.fr": "L'Union", "charentelibre.fr": "Charente Libre", "larepubliquedespyrenees.fr": "La République des Pyrénées",
  "corsematin.com": "Corse-Matin", "actu.fr": "actu.fr", "parismatch.com": "Paris Match",
};

/** Presse people, contenus à clics et agrégateurs : jamais publiés, même dans un fil local. */
const EXCLUS = /(^|\.)(gala\.fr|voici\.fr|closermag\.fr|public\.fr|ohmymag\.com|gentside\.com|purepeople\.com|planet\.fr|melty\.fr|aufeminin\.com|msn\.com|yahoo\.com|orange\.fr|wansquare\.com)$/i;
export const mediaExclu = (url: string) => { try { return EXCLUS.test(new URL(url).hostname); } catch { return true; } };

/**
 * Bing Actualités (RSS, gratuit) : contrairement à Google Actualités, il donne l'adresse réelle de
 * l'article, sa date et un vrai extrait. Pas de OR entre deux expressions entre guillemets (0 résultat) : une requête par terme.
 */
export async function presseBing(requete: string): Promise<ResultatPresse[] | null> {
  try {
    const r = await fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(requete)}&format=rss&setlang=fr-FR&cc=FR`, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const xml = await r.text();
    const dec = (t: string) => t.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).trim();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, i]) => {
      const champ = (n: string) => dec(i.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`))?.[1] ?? "");
      let link = champ("link");
      try { link = new URL(link).searchParams.get("url") || link; } catch { /* adresse telle quelle */ }
      return { link, title: champ("title"), snippet: champ("description").replace(/<[^>]+>/g, " ").trim(), date: dateValide(champ("pubDate")) ?? undefined };
    }).filter(x => x.link && x.title);
  } catch { return null; }
}

export function mediaReconnu(url: string): string | null {
  try {
    const hote = new URL(url).hostname.replace(/^www\./, "");
    const cle = Object.keys(MEDIAS_RECONNUS).find(d => hote === d || hote.endsWith(`.${d}`));
    return cle ? MEDIAS_RECONNUS[cle] : null;
  } catch { return null; }
}

export type ResultatPresse = { link: string; title: string; snippet?: string; date?: string };

/**
 * Recherche d'articles : Serper (0,001 $), sinon Exa (0,007 $) limité aux médias reconnus. Serper est
 * tombé en panne le 31/10/2026 : sans secours, plus aucun article nouveau. `null` : les deux en échec.
 */
export async function chercherPresse(q: string): Promise<ResultatPresse[] | null> {
  const s = await executer("serper/news", { q, gl: "fr", hl: "fr", num: 10 });
  if (s.ok === true) return s.sortie?.news ?? [];
  console.log(`[Presse] Serper indisponible (${s.raison}) : secours Exa.`);
  const e = await executer("exa/search", { query: q.replace(/"/g, ""), numResults: 10, includeDomains: Object.keys(MEDIAS_RECONNUS) });
  if (e.ok === false) { console.log(`::warning::[Presse] Recherche impossible : ${e.raison}`); return null; }
  return (e.sortie?.results ?? []).map((r: any) => ({ link: r.url, title: r.title || "", date: r.publishedDate }));
}

export const norm = (t: string) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘`]/g, "'").replace(/[«»“”"]/g, " ").replace(/\s+/g, " ").toLowerCase().trim();
const UA = { "User-Agent": "Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)" };

const JOUR = 864e5;
const dateValide = (v: unknown): string | null => {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string" || !/\d{4}/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) && t > Date.UTC(2000, 0, 1) ? new Date(t).toISOString() : null;
};

/** Date de PUBLICATION écrite dans la page (jamais la date de modification). */
export function dateDansHtml(html: string): string | null {
  const motifs = [
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|og:article:published_time|datePublished|publication_date|pubdate|date|DC\.date\.issued)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["'](?:article:published_time|datePublished|publication_date|pubdate)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const m of motifs) { const d = dateValide(html.match(m)?.[1]); if (d) return d; }
  return null;
}

function texteDuHtml(html: string): string {
  const net = html.replace(/<(script|style|noscript|nav|footer|aside)[\s\S]*?<\/\1>/gi, " ");
  return [...net.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => m[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;|&apos;/g, "'").replace(/&quot;|&laquo;|&raquo;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim())
    .filter(t => t.length > 40).join("\n");
}

export type Article = { texte: string; date: string | null; via: "direct" | "agentik" };

/** Lecture gratuite d'abord ; Agentik (0,0025 $) si le site refuse ou ne livre pas son texte. */
export async function lireArticle(url: string, { gratuit = false } = {}): Promise<Article | null> {
  let date: string | null = null, texte = "";
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(gratuit ? 10000 : 20000), redirect: "follow" });
    if (r.ok) { const html = await r.text(); date = dateDansHtml(html); texte = texteDuHtml(html); }
  } catch { /* lecture par Agentik */ }
  if (date && texte.length >= 800) return { texte, date, via: "direct" };
  if (gratuit) return texte.length >= 500 ? { texte, date, via: "direct" } : null;
  // Exa d'abord (0,001 $, date de publication fournie), Firecrawl en secours (0,0025 $).
  const exa: ResultatAgentik = await executer("exa/contents", { urls: [url], text: true });
  const lu = exa.ok === true ? exa.sortie?.results?.[0] : null;
  if (lu && typeof lu.text === "string" && lu.text.length >= 500) {
    const meilleur = lu.text.length > texte.length ? lu.text : texte;
    return { texte: meilleur, date: date || dateValide(lu.publishedDate), via: "agentik" };
  }
  const r: ResultatAgentik = await executer("firecrawl/scrape", { url, onlyMainContent: true });
  if (r.ok === false) { console.log(`  · lecture impossible (${r.raison}) : ${url.slice(0, 80)}`); return texte.length >= 500 ? { texte, date, via: "direct" } : null; }
  // Sans la syntaxe des liens et des images : une citation doit se retrouver dans le texte lu.
  const md = (typeof r.sortie?.markdown === "string" ? r.sortie.markdown : "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_#>]+/g, " ");
  const meta = r.sortie?.metadata || {};
  const dateFc = dateValide(meta.publishedTime) || dateValide(meta["article:published_time"]) || dateValide(meta.datePublished) || dateValide(meta.pubdate) || dateValide(meta["date"]);
  const meilleur = md.length > texte.length ? md : texte;
  return meilleur.length >= 500 ? { texte: meilleur, date: date || dateFc, via: "agentik" } : null;
}

/** Appel du modèle en JSON, à partir d'un texte fourni. */
export async function jsonDuModele(system: string, user: string): Promise<any | null> {
  // VERIF_PAYANT=1 (rattrapage) : DeepSeek directement, dépense notée. Sinon gratuit d'abord.
  const payant = process.env.VERIF_PAYANT === "1";
  // sansReflexion : sinon, sur un long texte, DeepSeek épuise max_tokens à réfléchir et répond à vide.
  const rep = await resilientDeepSeek.createMessage({ model: "deepseek-chat", max_tokens: 3000, responseFormat: "json_object", sansReflexion: true, system, messages: [{ role: "user", content: user }] }, { payant });
  if (payant) await noter("agentik", "deepseek-flash", coutUsage("deepseek-flash", rep.usage), "contrôle d'article");
  const m = (rep.content[0]?.text ?? "").match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

const nombres = (t: string) => (t.replace(/(\d)[\s.  ](?=\d{3}\b)/g, "$1").match(/\d+(?:[.,]\d+)?/g) || []);
export const chiffresDansTexte = (resume: string, texte: string) => {
  const dispo = new Set(nombres(texte));
  return nombres(resume).every(n => dispo.has(n));
};
export const citationDansTexte = (citation: string, texte: string) => {
  const c = norm(citation);
  return c.length >= 20 && norm(texte).includes(c);
};
const nomDeFamille = (nom: string) => nom.split(" ").pop() || nom;

const SENSIBLE = /candidat|candidature|se retire|retrait|renonce|ralli|soutien|investi|mis en examen|condamn|perquisition|enqu[êe]te|d[ée]mission/i;
const MOTS_VIDES = new Set(["apres", "avant", "contre", "entre", "depuis", "cette", "selon", "ainsi", "alors", "aussi", "encore", "faire", "avoir", "etre", "france", "politique", "election", "presidentielle"]);

/** Un autre média reconnu rapporte-t-il le MÊME fait ? Des mots communs ne le prouvent pas. */
async function confirmeAilleurs(nom: string, fait: string, media: string): Promise<boolean> {
  const fam = norm(nomDeFamille(nom));
  const trouves = await chercherPresse(`"${nom}" ${fait.slice(0, 90)}`);
  if (!trouves) return false;
  const autres = trouves.filter((n: any) => {
    const m = mediaReconnu(n.link);
    return m && m !== media && norm(`${n.title} ${n.snippet}`).includes(fam);
  });
  if (!autres.length) return false;
  const j = await jsonDuModele(`On te donne un fait et des titres de presse. Un titre confirme le fait seulement s'il rapporte ce MÊME événement, pas un sujet voisin, une rumeur ou un épisode antérieur. Réponds en JSON strict : { "confirme": bool }`,
    `Fait : ${fait}\n\nTitres :\n${autres.map((n: any) => `- ${n.date ?? ""} | ${n.title} | ${n.snippet ?? ""}`).join("\n")}`);
  return j?.confirme === true;
}

export type Verdict =
  | { ok: true; date: string; titre: string; resume: string; citation: string; type: string; media: string }
  | { ok: false; motif: string; date?: string | null; media: string | null };

/** Tous les contrôles, du moins cher au plus cher. */
export async function verifierArticle(nom: string, titre: string, url: string, { joursMax = 30, termes = [] as string[], role = "personnalité de la présidentielle 2027" } = {}): Promise<Verdict> {
  const media = mediaReconnu(url);
  if (!media) return { ok: false, motif: "média non reconnu", media };
  const article = await lireArticle(url);
  if (!article) return { ok: false, motif: "article illisible", media };
  if (!article.date) return { ok: false, motif: "date introuvable dans l'article", media };
  const age = (Date.now() - Date.parse(article.date)) / JOUR;
  if (age > joursMax) return { ok: false, motif: `article ancien (${article.date.slice(0, 10)})`, date: article.date, media };
  if (age < -1) return { ok: false, motif: "date dans le futur", date: article.date, media };
  const lu = norm(article.texte);
  const cherches = termes.length ? [nom, ...termes] : [nomDeFamille(nom)];
  if (!cherches.some(t => lu.includes(norm(t)))) return { ok: false, motif: "personne absente du texte", date: article.date, media };

  // Phrases numérotées : le modèle désigne la preuve et le programme la recopie, donc la citation est
  // forcément mot pour mot (recopiée par le modèle, une sur trois était légèrement altérée).
  const phrases = article.texte.replace(/\s+/g, " ").split(/(?<=[.!?»])\s+(?=[A-ZÀ-Ý«"])/).filter(p => p.length >= 50 && p.length <= 400).slice(0, 80);
  if (phrases.length < 3) return { ok: false, motif: "article illisible", date: article.date, media };
  const j = await jsonDuModele(`Tu contrôles un article de presse pour le fil d'actualité de ${nom}, ${role}, sur un site d'information neutre. Nous sommes le ${new Date().toISOString().slice(0, 10)}. L'article est daté du ${article.date.slice(0, 10)}.

N'utilise QUE le texte fourni, jamais tes connaissances. Réponds en JSON strict :
{ "concerne": bool, "actuel": bool, "sensible": bool, "entretien": bool, "titre": "...", "resume": "...", "preuve": 0, "type": "interview|soutien|programme|declaration|sondage|actualite" }

- concerne : l'article parle vraiment de ${nom} (pas une simple mention, ni un homonyme). false pour un article-liste du type « tous les candidats » ou un récapitulatif.
- actuel : il rapporte un fait survenu dans les jours qui précèdent sa date ; false s'il rappelle surtout un fait plus ancien (une annonce d'il y a plusieurs mois, une ancienne fonction).
- sensible : il annonce une candidature, un retrait, un ralliement, ou une affaire judiciaire.
- entretien : l'article est un entretien avec ${nom} en personne, qui s'y exprime lui-même ou elle-même.
- titre : factuel, 14 mots au plus, sans accroche ni « découvrez », et sans aller plus loin que le texte.
- resume : 2 phrases, 45 mots au plus, seulement ce que dit le texte, sans jugement ; attribue les opinions à leur auteur.
- preuve : le NUMÉRO de la phrase du texte qui prouve le mieux le résumé.`,
    `Titre d'origine : ${titre}\nMédia : ${media}\n\nTexte, phrase par phrase :\n${phrases.map((p, i) => `[${i}] ${p}`).join("\n")}`);
  if (!j) return { ok: false, motif: "contrôle IA sans réponse", date: article.date, media };
  if (!j.concerne) return { ok: false, motif: "ne concerne pas vraiment la personne", date: article.date, media };
  if (!j.actuel) return { ok: false, motif: "porte sur un passé ancien", date: article.date, media };
  const citation = phrases[Number(j.preuve)];
  if (!j.titre || !j.resume || !citation) return { ok: false, motif: "réponse IA incomplète", date: article.date, media };
  if (/d[ée]couvrez|ne manquez pas|tout savoir/i.test(`${j.titre} ${j.resume}`)) return { ok: false, motif: "formulation d'accroche", date: article.date, media };
  if (!chiffresDansTexte(`${j.titre} ${j.resume}`, article.texte)) return { ok: false, motif: "chiffre absent du texte", date: article.date, media };
  // Sa propre parole, dans un entretien publié par un média reconnu, fait foi ; le reste est recoupé.
  if (!j.entretien && (j.sensible || SENSIBLE.test(j.titre)) && !(await confirmeAilleurs(nom, j.titre, media))) return { ok: false, motif: "annonce sensible sans second média", date: article.date, media };
  const types = ["interview", "soutien", "programme", "declaration", "sondage", "actualite"];
  return { ok: true, date: article.date, titre: j.titre, resume: j.resume, citation, type: types.includes(j.type) ? j.type : "actualite", media };
}

/**
 * Une entrée de « Controverses » est-elle confirmée par de vrais articles ? Une affaire nouvelle : deux
 * médias reconnus au moins ; un développement d'une affaire établie : un seul suffit. Chaque source
 * renvoyée a été lue, avec une phrase recopiée du texte.
 */
export async function verifierControverse(nom: string, texte: string, { developpement = false, joursMax = 400, titres = [] as string[] } = {}): Promise<
  { ok: true; corrige: string | null; sources: { media: string; url: string; date: string | null; titre: string; citation: string }[] } | { ok: false; motif: string }
> {
  const besoin = developpement ? 1 : 2;
  const fam = norm(nomDeFamille(nom));
  const mots = [...new Set(norm(texte.replace(/^[^:]{0,25}:/, "")).split(/[^a-z0-9]+/))].filter(m => m.length >= 6 && m !== fam && !MOTS_VIDES.has(m)).slice(0, 5);
  const trouves = new Map<string, ResultatPresse>();
  const ajouter = (l: ResultatPresse[] | null) => { for (const n of l ?? []) { const m = mediaReconnu(n.link); if (m && ![...trouves.values()].some(x => mediaReconnu(x.link) === m)) trouves.set(n.link, n); } };
  // D'abord les titres exacts des articles d'origine. Une recherche sur des mots généraux (« enquête »,
  // « ouverte ») ramenait d'autres affaires : aucune entrée n'était confirmée, à tort.
  for (const t of titres.slice(0, 4)) {
    if (trouves.size >= 4) break;
    ajouter(await presseBing(t.replace(/["«»]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)));
  }
  if (trouves.size < besoin + 1) ajouter(await presseBing(`"${nom}" ${mots.join(" ")}`));
  if (trouves.size < besoin) ajouter(await chercherPresse(`"${nom}" ${mots.slice(0, 3).join(" ")}`));
  if (trouves.size < besoin) return { ok: false, motif: `moins de ${besoin} média(s) reconnu(s) trouvé(s)` };

  const lus: { n: ResultatPresse; media: string; date: string | null; phrases: string[] }[] = [];
  for (const n of [...trouves.values()].slice(0, 5)) {
    if (lus.length >= 4) break;
    const a = await lireArticle(n.link);
    if (!a || !norm(a.texte).includes(fam)) continue;
    if (a.date && Date.now() - Date.parse(a.date) > joursMax * JOUR) continue;
    const phrases = a.texte.replace(/\s+/g, " ").split(/(?<=[.!?»])\s+(?=[A-ZÀ-Ý«"])/).filter(p => p.length >= 40 && p.length <= 400).slice(0, 40);
    if (phrases.length >= 2) lus.push({ n, media: mediaReconnu(n.link)!, date: a.date, phrases });
  }
  // Plafond de dépense atteint : ce n'est pas un verdict sur l'entrée, on la relira plus tard.
  if (lus.length < besoin && plafondAtteint()) return { ok: false, motif: "contrôle IA sans réponse (plafond atteint)" };
  if (lus.length < besoin) return { ok: false, motif: `moins de ${besoin} article(s) lisible(s) de médias reconnus` };

  const j = await jsonDuModele(`Tu vérifies une entrée de la rubrique « Controverses » d'une fiche sur ${nom}, sur un site d'information neutre. N'utilise QUE les articles fournis, phrase par phrase, jamais tes connaissances.
Réponds en JSON strict : { "articles": [{ "article": 0, "confirme": bool, "phrase": 0 }], "tout_confirme": bool, "non_confirme": "...", "corrige": "..." }
- articles : pour chaque article, s'il rapporte le même fait principal, à propos de cette même personne, et le numéro de la phrase qui le prouve.
- tout_confirme : true seulement si chaque fait, date, nom et chiffre de l'entrée se retrouve dans au moins un article.
- non_confirme : ce qui ne s'y retrouve pas, en quelques mots (chaîne vide sinon).
- corrige : si le fait principal est confirmé mais pas tous les détails, l'entrée réécrite avec UNIQUEMENT ce que disent les articles : même format (« Mois année : … »), une à trois phrases, factuelles, au conditionnel ou attribuées tant que la justice n'a pas tranché, en nommant les médias des articles fournis, sans jugement. Chaîne vide sinon.`,
    `Entrée à vérifier : ${texte}\n\n${lus.map((l, i) => `ARTICLE ${i} (${l.media}, ${l.date?.slice(0, 10) ?? "date inconnue"})\n${l.phrases.map((p, k) => `[${k}] ${p}`).join("\n")}`).join("\n\n")}`);
  if (!j) return { ok: false, motif: "contrôle IA sans réponse" };
  const sources = (Array.isArray(j.articles) ? j.articles : []).filter((a: any) => a?.confirme && lus[Number(a.article)]?.phrases[Number(a.phrase)]).map((a: any) => {
    const l = lus[Number(a.article)];
    return { media: l.media, url: l.n.link, date: l.date, titre: l.n.title, citation: l.phrases[Number(a.phrase)] };
  }).filter((x: any, i: number, t: any[]) => t.findIndex(y => y.url === x.url) === i);
  const medias = new Set(sources.map((x: any) => x.media));
  if (medias.size < besoin) return { ok: false, motif: `confirmée par ${medias.size} média(s) sur ${besoin} requis` };
  if (j.tout_confirme) return { ok: true, corrige: null, sources };
  // Fait confirmé, détails non : l'entrée est réécrite d'après les articles, plutôt que retirée.
  const corrige = String(j.corrige || "").trim();
  const lusTexte = lus.flatMap(l => l.phrases).join(" ");
  if (corrige.length >= 40 && chiffresDansTexte(corrige, lusTexte)) return { ok: true, corrige, sources };
  return { ok: false, motif: `en partie non confirmée : ${String(j.non_confirme || "").slice(0, 160)}` };
}
