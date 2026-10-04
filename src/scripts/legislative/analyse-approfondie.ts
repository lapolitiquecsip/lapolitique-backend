import "dotenv/config";
import pdf from "pdf-parse/lib/pdf-parse.js";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek, DEEPSEEK_FLASH } from "../../lib/deepseek-client.js";

// ANALYSE APPROFONDIE d'un texte de loi (offre Premium / Pro).
//
// L'analyse « premium » existante ne décrivait que la procédure, faute d'accès au
// contenu. Celle-ci LIT LE TEXTE : sur la page du dossier à l'Assemblée, on prend
// le dernier texte adopté (séance, sinon commission, sinon texte déposé), l'exposé
// des motifs du texte initial et, pour un projet de loi, l'étude d'impact — tous en
// PDF, publics. Deux passes de modèle :
//   1. l'analyse : chaque mesure, avant / après, chiffres, publics, calendrier,
//      sanctions, financement — le lecteur doit tout savoir du texte ;
//   2. le cadre existant : ce que prévoit DÉJÀ le droit dans ce domaine (étude
//      d'impact, exposé des motifs, fiches service-public du même sujet).
//
// Usage :
//   npx tsx src/scripts/legislative/analyse-approfondie.ts                 # dossiers prioritaires
//   npx tsx src/scripts/legislative/analyse-approfondie.ts --dossier=<uuid> [--force]
//   npx tsx src/scripts/legislative/analyse-approfondie.ts --max=5
//   Campagne payante (DeepSeek), dossiers actifs depuis un an, 6 $ au plus par passage :
//   npx tsx src/scripts/legislative/analyse-approfondie.ts --payant --depuis=365 --max=300 --parallele=5 --budget=6
//   Chiffrage sans appel au modèle : ajouter --mesurer

const args = process.argv.slice(2);
const opt = (n: string) => args.find(a => a.startsWith(`--${n}=`))?.split("=")[1];
const FORCE = args.includes("--force");
const MAX = Number(opt("max") || 6);
const UN_DOSSIER = opt("dossier");
const PAYANT = args.includes("--payant");
const DEPUIS = Number(opt("depuis") || 0);          // jours ; 0 = dossiers prioritaires seulement
const BUDGET = Number(opt("budget") || 0);          // dollars par passage ; 0 = sans plafond
const PARALLELE = Math.max(1, Number(opt("parallele") || 1));

// Tarif DeepSeek flash (dollars par million de tokens), heures creuses ; doublé en
// heures pleines (01-04 h et 06-10 h UTC, du lundi au vendredi).
const PRIX_ENTREE = Number(process.env.DEEPSEEK_PRIX_ENTREE || 0.15);
const PRIX_SORTIE = Number(process.env.DEEPSEEK_PRIX_SORTIE || 0.6);
const PRIX_CACHE = Number(process.env.DEEPSEEK_PRIX_CACHE || 0.003);   // entrée déjà en cache
function heuresPleines(d = new Date()) {
  const j = d.getUTCDay(), h = d.getUTCHours();
  return j >= 1 && j <= 5 && ((h >= 1 && h < 4) || (h >= 6 && h < 10));
}
const coutAppel = (entree: number, sortie: number, cache = 0) =>
  (((entree - cache) * PRIX_ENTREE + cache * PRIX_CACHE + sortie * PRIX_SORTIE) / 1e6) * (heuresPleines() ? 2 : 1);
const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitiquecestsimple.fr)" };
const AN = "https://www.assemblee-nationale.fr";
// Version de la méthode : une analyse écrite par une méthode plus ancienne est refaite.
const VERSION = "approfondie-v4 (mesures regroupées, sans références, 8-15 chiffres)";

const propre = (t: string) => t
  .replace(/ /g, " ")
  .replace(/–\s*\d+\s*–/g, " ")          // numéros de page « – 3 – »
  .replace(/[ \t]+/g, " ")
  .replace(/\s*\n\s*/g, "\n")
  .replace(/\n{2,}/g, "\n")
  .trim();

/**
 * Une page de l'Assemblée, avec deux nouveaux essais : un raté réseau passager
 * faisait passer une loi pour « sans texte lisible » (et la mettait de côté 7 jours).
 * Une vraie absence (404) répond tout de suite, sans nouvel essai.
 */
async function recuperer(url: string, delai: number): Promise<Response | null> {
  for (let essai = 1; essai <= 3; essai++) {
    try {
      const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(delai) });
      if (r.ok || r.status === 404) return r;
    } catch { /* réseau : on réessaie */ }
    await pause(3000 * essai);
  }
  return null;
}

async function lirePdf(url: string): Promise<string | null> {
  try {
    const r = await recuperer(url, 60000);
    if (!r?.ok || !/pdf/i.test(r.headers.get("content-type") || "")) return null;
    const d = await pdf(Buffer.from(await r.arrayBuffer()));
    return d.text ? propre(d.text) : null;
  } catch { return null; }
}

type Documents = {
  version: string;
  final: { titre: string; url: string; texte: string } | null;
  initial: { titre: string; url: string; texte: string } | null;
  etude: { titre: string; url: string; texte: string } | null;
};

/**
 * Les textes d'un dossier, depuis sa page à l'Assemblée. Les identifiants de texte
 * suivent un schéma stable : « l17b2841_projet-loi » (texte déposé, numéro de
 * document) ou « l17t0338_texte-adopte-seance » (texte adopté, numéro de TA).
 */
async function documents(sourceUrls: string[]): Promise<Documents | null> {
  let page = sourceUrls.find(u => /assemblee-nationale\.fr\/dyn\/\d+\/dossiers\//.test(u));
  // Texte venu du Sénat : sa page renvoie vers le dossier de l'Assemblée, parfois
  // sous l'ancienne adresse « /17/dossiers/<nom>.asp », que l'on convertit.
  if (!page) {
    for (const s of sourceUrls.filter(u => /senat\.fr\/dossier-legislatif\//.test(u))) {
      const html = await fetch(s, { headers: UA, signal: AbortSignal.timeout(30000) }).then(r => (r.ok ? r.text() : "")).catch(() => "");
      const m = html.match(/assemblee-nationale\.fr\/(?:dyn\/)?(\d+)\/dossiers\/([A-Za-z0-9_-]+?)(?:\.asp)?["#?]/);
      if (m) { page = `${AN}/dyn/${m[1]}/dossiers/${m[2]}`; break; }
    }
  }
  if (!page) return null;
  const html = await recuperer(page, 30000).then(r => (r?.ok ? r.text() : "")).catch(() => "");
  const ids = [...new Set([...html.matchAll(/\/dyn\/(\d+)\/textes\/(l\d+[bt]\d+_[a-z-]+)/g)].map(m => `${m[1]}|${m[2]}`))]
    .map(x => { const [leg, id] = x.split("|"); return { leg, id, num: Number(id.match(/l\d+[bt](\d+)/)?.[1] || 0), t: id.includes("t") && /^l\d+t/.test(id) }; });
  if (!ids.length) return null;
  const pdfUrl = (x: { leg: string; id: string }) => `${AN}/dyn/${x.leg}/textes/${x.id}.pdf`;

  const par = (re: RegExp) => ids.filter(x => re.test(x.id)).sort((a, b) => b.num - a.num);
  // Du plus abouti au texte déposé : le PDF d'un texte de commission tout juste
  // adopté n'est souvent pas encore publié, on prend alors le suivant. Le texte
  // réellement lu fait la version : quand le PDF paraît, l'analyse est refaite.
  const candidats = [
    ...par(/_texte-adopte-seance$|_texte-adopte$/), ...par(/_texte-adopte-commission$/),
    ...par(/_(projet|proposition)-loi(-organique)?$/),
  ];
  const initial = par(/_(projet|proposition)-loi(-organique)?$/).slice(-1)[0];
  const etude = par(/_etude-impact$/).slice(-1)[0];
  let final: (typeof ids)[number] | undefined, tf: string | null = null;
  for (const c of candidats.slice(0, 4)) {
    tf = await lirePdf(pdfUrl(c));
    if (tf) { final = c; break; }
  }
  if (!final) return null;

  const [ti, te] = await Promise.all([
    initial && initial.id !== final.id ? lirePdf(pdfUrl(initial)) : Promise.resolve(null),
    etude ? lirePdf(pdfUrl(etude)) : Promise.resolve(null),
  ]);
  const nom = (x: { id: string }) => x.id.replace(/^l\d+[bt]\d+_/, "").replace(/-/g, " ");
  return {
    version: final.id.split("_")[0],
    final: tf ? { titre: `${nom(final)} (${final.id.split("_")[0]})`, url: pdfUrl(final), texte: tf } : null,
    initial: ti ? { titre: `${nom(initial!)} (${initial!.id.split("_")[0]})`, url: pdfUrl(initial!), texte: ti } : null,
    etude: te ? { titre: `Étude d'impact (${etude!.id.split("_")[0]})`, url: pdfUrl(etude!), texte: te } : null,
  };
}

/** L'exposé des motifs : ce qui précède le dispositif (« PROJET DE LOI » / « Article 1er »). */
function exposeDesMotifs(texte: string): string {
  const debut = texte.search(/EXPOS[ÉE] DES MOTIFS/i);
  const t = debut >= 0 ? texte.slice(debut) : texte;
  const fin = t.slice(200).search(/\n(PROJET|PROPOSITION) DE LOI\b|\nArticle (1er|premier)\b/i);
  return (fin > 0 ? t.slice(0, fin + 200) : t).slice(0, 30000);
}

/**
 * Dans une étude d'impact (souvent 200 pages et plus), les passages qui décrivent
 * le droit ACTUEL : « état des lieux », « état du droit », « cadre général »,
 * « droit existant ». On en garde des tranches bornées, dans l'ordre du document.
 */
function droitExistant(etude: string, plafond = 50000): string {
  const re = /(état des lieux|état du droit|droit existant|cadre général|cadre juridique|situation actuelle|droit en vigueur)/gi;
  const morceaux: string[] = [];
  let total = 0, dernier = -1;
  for (const m of etude.matchAll(re)) {
    const i = m.index ?? 0;
    if (i < dernier) continue;
    const bout = etude.slice(i, i + 3500);
    morceaux.push(bout);
    total += bout.length; dernier = i + 3500;
    if (total > plafond) break;
  }
  return (morceaux.length ? morceaux.join("\n[…]\n") : etude.slice(0, plafond)).slice(0, plafond);
}

/**
 * Le dispositif découpé en tranches d'articles entiers (~45 000 caractères) : une
 * loi de 180 000 caractères ne tient pas en une réponse détaillée, et ce qui dépasse
 * serait simplement omis. Chaque tranche est analysée à part, article par article.
 */
function tranches(texte: string, taille = 45000): string[] {
  const debuts = [...texte.matchAll(/\n\s*Article\s+(?:\d+|premier|unique)\b[^\n]{0,30}\n/gi)].map(m => m.index ?? 0);
  if (debuts.length < 2) return texte.match(new RegExp(`[\\s\\S]{1,${taille}}`, "g")) || [texte];
  const sortie: string[] = [];
  let depart = debuts[0];
  for (let k = 1; k <= debuts.length; k++) {
    const fin = k < debuts.length ? debuts[k] : texte.length;
    if (fin - depart > taille && debuts[k - 1] > depart) {
      sortie.push(texte.slice(depart, debuts[k - 1]));
      depart = debuts[k - 1];
    }
  }
  sortie.push(texte.slice(depart));
  // Un article seul peut dépasser la taille : on le laisse entier jusqu'à 90 000.
  return sortie.map(s => s.slice(0, 90000));
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

// Plus rien à faire dans ce passage : quota gratuit du jour ou solde payant épuisé.
// En payant, « 402 Insufficient Balance » = solde vidé en cours de passage.
const ARRET = /Aucun modèle gratuit disponible|Solde DeepSeek épuisé|Insufficient Balance|\b402\b/;

/**
 * Un appel au modèle qui doit rendre du JSON ; un JSON mal formé est redemandé.
 * En gratuit, un quota saturé attend que les modèles écartés 5 min reviennent.
 * En payant, chaque appel ajoute son coût réel (tokens facturés) à `cout`.
 * Les plafonds de sortie sont larges : le modèle raisonne avant de répondre, et un
 * plafond trop bas donne une réponse VIDE sans erreur. On ne paie que l'utilisé.
 */
type Cout = { usd: number; entree?: number; cache?: number; sortie?: number };
/** Tout ce qui a été facturé dans ce passage, échecs compris (le solde en témoigne). */
let DEPENSE_TOTALE = 0;
async function demanderJson(systeme: string, contenu: string, maxTokens: number, cout: Cout, essais = 4): Promise<any> {
  let derniere: any;
  for (let essai = 1; essai <= essais; essai++) {
    try {
      const r = await resilientDeepSeek.createMessage({
        // En payant, plafond large : le modèle raisonne d'abord, et 25 000 tokens de
        // réflexion avaient suffi à tronquer une réponse plafonnée à 32 000.
        model: PAYANT ? DEEPSEEK_FLASH : "deepseek-chat", max_tokens: PAYANT ? maxTokens * 4 : maxTokens,
        responseFormat: "json_object", system: systeme, messages: [{ role: "user", content: contenu }],
        sansReflexion: PAYANT,
      }, { timeoutMs: PAYANT ? 420000 : 240000, payant: PAYANT });
      if (PAYANT) {
        const c = coutAppel(r.usage?.input_tokens || 0, r.usage?.output_tokens || 0, r.usage?.cache_hit_tokens || 0);
        cout.usd += c; DEPENSE_TOTALE += c;
        cout.entree = (cout.entree || 0) + (r.usage?.input_tokens || 0);
        cout.cache = (cout.cache || 0) + (r.usage?.cache_hit_tokens || 0);
        cout.sortie = (cout.sortie || 0) + (r.usage?.output_tokens || 0);
      }
      const texte = r.content?.[0]?.type === "text" ? r.content[0].text : "";
      const m = texte.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("réponse sans JSON");
      return JSON.parse(m[0]);
    } catch (e) {
      derniere = e;
      if (ARRET.test(String((e as Error).message))) throw e;
      console.warn(`    ! essai ${essai}/${essais} : ${(e as Error).message}`);
      if (essai === essais) break;
      const quota = !PAYANT && essai === 1 && !/JSON/.test(String((e as Error).message));
      await pause(quota ? 330000 : (PAYANT ? 10000 : 30000) * essai);
    }
  }
  throw derniere;
}

const SYSTEME_MESURES = `Tu es juriste et pédagogue. On te donne UN EXTRAIT du texte d'une loi (une suite d'articles complets) et son exposé des motifs.
Explique ce que CET EXTRAIT change concrètement, pour un lecteur qui n'est pas juriste : après t'avoir lu, il sait exactement ce qui change, pour qui et à partir de quand, sans ouvrir le texte.

CE QU'EST UNE MESURE
- Une mesure = UN changement concret pour quelqu'un (une personne, une famille, un professionnel, une entreprise, une administration).
- REGROUPE en une seule mesure les modifications techniques qui servent la même règle. Exemple : si l'extrait étend un contrôle à vingt professions en modifiant vingt codes, c'est UNE mesure qui énumère ces professions — pas vingt.
- IGNORE les coordinations rédactionnelles, renumérotations, renvois et corrections de références.
- En général 4 à 15 mesures par extrait ; davantage seulement si l'extrait contient vraiment plus de changements distincts.

COMMENT L'ÉCRIRE
- Uniquement ce que disent les documents. Aucune information extérieure, aucun chiffre inventé.
- Français courant. Ne recopie pas le texte de loi. Aucune référence d'article ou de code dans "titre", "avant", "apres" ni "detail" : n'écris pas « le 3° de l'article 375-3 » ni « la section 3 du chapitre II du titre II du livre II du code pénal », dis de quoi il s'agit (« le placement de l'enfant hors de sa famille », « les viols sur mineurs »). Les références vont dans "article" seulement. Un terme juridique inévitable s'explique entre parenthèses.
- Tous les chiffres exacts : âges, durées, délais, montants, seuils, peines, dates.
- Aucun jugement de valeur.

LES CHAMPS
- "titre" : court et concret (« Le placement d'un enfant limité à 2 ans, renouvelable sur décision motivée »).
- "article" : le ou les numéros EXACTEMENT tels qu'ils figurent dans l'extrait (« Art. 5 », « Art. 5 et 6 »). N'invente pas de « bis ».
- "avant" : la règle qui s'appliquait jusqu'ici, SEULEMENT si elle est connue : quand le texte REMPLACE des mots ou des chiffres (« les mots « deux ans » sont remplacés par « trois ans » »), ou quand l'exposé des motifs la décrit. Ne la déduis jamais du seul fait qu'une règle est ajoutée : dans ce cas, chaîne vide (l'interface affichera seulement « ce que change la loi »).
- "apres" : la nouvelle règle, en une ou deux phrases.
- "detail" : 2 à 5 phrases concrètes — conditions, exceptions, chiffres, qui décide.
- "qui" : qui est concerné.

FORMAT — un objet JSON :
{ "mesures": [{"titre": "…", "article": "Art. 3", "avant": "…", "apres": "…", "detail": "…", "qui": "…"}] }`;

const SYSTEME_ANALYSE = `Tu es juriste et pédagogue. On te donne le TEXTE D'UNE LOI (sa dernière version adoptée) et son exposé des motifs.
Ses mesures, article par article, sont décrites ailleurs : toi, tu rédiges la VUE D'ENSEMBLE, en français clair.

RÈGLES
- Uniquement ce que disent les documents. Aucune information extérieure, aucun chiffre inventé.
- Recopie les chiffres et dates EXACTEMENT. Cite les articles tels qu'ils figurent dans le texte.
- Calendrier : TOUTES les dates et délais d'entrée en vigueur prévus par le texte.
- Sanctions : TOUTES les peines et sanctions créées ou modifiées, avec leurs montants.
- Français courant ; un terme juridique inévitable s'explique entre parenthèses. Aucun jugement de valeur.

FORMAT — un objet JSON :
{
  "en_une_phrase": "ce que fait la loi, en une phrase",
  "contexte": "4 à 6 phrases : le problème visé, avec les chiffres donnés par l'exposé des motifs",
  "chiffres_cles": [{"valeur": "…", "libelle": "…"}]   (8 à 15 : durées, âges, délais, montants, seuils, peines du texte, et chiffres de la situation donnés par l'exposé des motifs),
  "concernes": [{"public": "…", "effet": "ce que ça change pour eux"}],
  "calendrier": [{"quand": "date, délai ou « au lendemain de la publication »", "quoi": "…"}],
  "sanctions": ["…"],
  "financement": "coût et financement, si les documents en parlent, sinon chaîne vide",
  "apports_parlement": "ce que les parlementaires ont ajouté ou modifié par rapport au texte initial, si on peut le voir, sinon chaîne vide",
  "points_debat": ["points sensibles ou controversés mentionnés par les documents"],
  "limites": "ce que ces documents ne permettent pas de dire, en une phrase"
}`;

const SYSTEME_CADRE = `Tu décris le CADRE LÉGISLATIF QUI EXISTE DÉJÀ dans un domaine, avant la loi qu'on te nomme.
On te donne des extraits de son étude d'impact (qui décrit l'état du droit), son exposé des motifs et des fiches pratiques officielles du même sujet.

RÈGLES
- Uniquement ce que disent les documents ; cite les textes (codes, lois, articles) tels qu'ils y figurent.
- Décris ce qui s'applique AUJOURD'HUI, sans la nouvelle loi : dispositifs, droits, obligations, acteurs, et les chiffres de la situation actuelle.
- Français courant, phrases courtes.

FORMAT — un objet JSON :
{
  "synthese": "4 à 6 phrases : l'état du droit et de la situation dans ce domaine",
  "dispositifs": [{"nom": "…", "description": "ce qu'il prévoit, chiffres compris", "reference": "code / loi / article, si cité"}],
  "chiffres": [{"valeur": "…", "libelle": "…"}],
  "acteurs": ["qui intervient aujourd'hui (administrations, collectivités, juges…)"],
  "lacunes": "ce que la situation actuelle ne règle pas, selon les documents"
}`;

/** Rend le coût de l'analyse en dollars (0 en gratuit), ou null si rien n'a été écrit. */
async function analyser(d: { id: string; title: string; short_title: string | null; source_urls: string[] }): Promise<number | null> {
  const cout: Cout = { usd: 0 };
  const docs = await documents(d.source_urls || []);
  if (!docs?.final) {
    console.log(`  · ${d.short_title || d.title} : aucun texte lisible à l'Assemblée`);
    await supabase.from("dossier_analyses_tentatives")
      .upsert({ dossier_id: d.id, raison: "aucun texte lisible", tente_le: new Date().toISOString() }, { onConflict: "dossier_id" });
    return null;
  }

  if (!FORCE) {
    const { data: deja } = await supabase.from("dossier_analyses_approfondies").select("texte_version, model").eq("dossier_id", d.id).maybeSingle();
    if (deja?.texte_version === docs.version && deja?.model === VERSION) { console.log(`  · déjà à jour (${docs.version}) : ${d.short_title || d.title}`); return null; }
  }

  const titre = d.short_title || d.title;
  const expose = docs.initial ? exposeDesMotifs(docs.initial.texte) : exposeDesMotifs(docs.final.texte);
  console.log(`  · ${titre} — texte ${docs.version} : ${docs.final.texte.length} car.${docs.etude ? `, étude d'impact ${docs.etude.texte.length} car.` : ""}`);

  // 1. Les mesures, tranche d'articles par tranche : rien n'est coupé.
  // En payant, des tranches plus petites : une tranche de 45 000 caractères a produit
  // une réponse trop longue (tronquée) ; 20 000 restent sous le plafond.
  const parts = tranches(docs.final.texte, PAYANT ? 20000 : 45000);
  const mesures: any[] = [];
  /**
   * Les mesures d'un extrait. Une réponse tronquée ne se répare pas en reposant la
   * même question (trois essais identiques avaient été payés pour rien) : en payant,
   * on coupe l'extrait en deux et on analyse chaque moitié.
   */
  const mesuresDe = async (part: string, etiquette: string, profondeur = 0): Promise<any[]> => {
    try {
      const r = await demanderJson(SYSTEME_MESURES,
        `LOI : ${d.title}\n\nEXPOSÉ DES MOTIFS (pour le contexte) :\n${expose.slice(0, 15000)}\n\nEXTRAIT ${etiquette} DU TEXTE ADOPTÉ :\n${part}`,
        16000, cout, PAYANT ? 1 : 4);
      return Array.isArray(r.mesures) ? r.mesures : [];
    } catch (e: any) {
      if (!PAYANT || ARRET.test(e.message) || profondeur >= 3 || part.length < 6000) throw e;
      const moities = tranches(part, Math.ceil(part.length / 2));
      const morceaux = moities.length > 1 ? moities : [part.slice(0, part.length / 2), part.slice(part.length / 2)];
      console.warn(`    ↳ extrait ${etiquette} trop long : coupé en ${morceaux.length}`);
      const sortie: any[] = [];
      for (const [i, m] of morceaux.entries()) sortie.push(...await mesuresDe(m, `${etiquette}.${i + 1}`, profondeur + 1));
      return sortie;
    }
  };
  for (const [k, part] of parts.entries()) {
    const liste = await mesuresDe(part, `${k + 1}/${parts.length}`);
    mesures.push(...liste);
    console.log(`    tranche ${k + 1}/${parts.length} : ${liste.length} mesures`);
    if (!PAYANT) await pause(15000); // quotas par minute des modèles gratuits
  }
  // 2. La vue d'ensemble, sur le texte entier.
  const analyse = await demanderJson(SYSTEME_ANALYSE,
    `LOI : ${d.title}\n\nEXPOSÉ DES MOTIFS :\n${expose}\n\nTEXTE ADOPTÉ (${docs.final.titre}) :\n${docs.final.texte.slice(0, 250000)}`, 12000, cout);
  analyse.mesures = mesures;

  // Fiches pratiques du même domaine : ce que le droit prévoit déjà, en clair.
  const requete = titre.replace(/\b(loi|projet|proposition|visant|relative?|relatif|portant|à|au|aux|des|les|la|le|de|du|et|pour)\b/gi, " ").replace(/\s+/g, " ").trim();
  const { data: fiches } = await supabase.rpc("search_fiches_pratiques", { q: requete, lim: 5 });
  const fichesTexte = (fiches || []).map((f: any) => `« ${f.title} » (${f.url})\n${String(f.body || "").slice(0, 3500)}`).join("\n\n");

  let cadre: any = null;
  try {
    cadre = await demanderJson(SYSTEME_CADRE,
      `LOI : ${d.title}\n\n${docs.etude ? `ÉTUDE D'IMPACT — état du droit :\n${droitExistant(docs.etude.texte)}\n\n` : ""}EXPOSÉ DES MOTIFS :\n${expose.slice(0, 15000)}\n\nFICHES PRATIQUES :\n${fichesTexte || "(aucune)"}`, 6000, cout);
    // Les liens, eux, viennent des fiches et jamais du modèle.
    cadre.fiches = (fiches || []).map((f: any) => ({ titre: f.title, url: f.url }));
    const vus = new Set<string>();
    cadre.textes = (fiches || []).flatMap((f: any) => f.refs || [])
      .filter((r: any) => r.url && !vus.has(r.url) && vus.add(r.url))
      .slice(0, 12).map((r: any) => ({ titre: r.titre, url: r.url }));
  } catch (e: any) {
    if (ARRET.test(e.message)) throw e;
    console.warn(`    ! cadre existant : ${e.message}`);
  }

  const sources = [docs.final, docs.initial, docs.etude].filter(Boolean).map(x => ({ titre: x!.titre, url: x!.url }));
  const { error } = await supabase.from("dossier_analyses_approfondies").upsert({
    dossier_id: d.id, analyse_loi: analyse, cadre, sources, texte_version: docs.version,
    model: VERSION, generated_at: new Date().toISOString(), cout_usd: PAYANT ? Number(cout.usd.toFixed(5)) : null,
  }, { onConflict: "dossier_id" });
  if (error) throw error;
  console.log(`    ✓ ${(analyse.mesures || []).length} mesures, ${(analyse.chiffres_cles || []).length} chiffres${cadre ? `, cadre : ${(cadre.dispositifs || []).length} dispositifs` : ""}${PAYANT ? ` · ${cout.usd.toFixed(4)} $ (entrée ${cout.entree} tokens dont ${cout.cache} en cache, sortie ${cout.sortie})` : ""}`);
  return cout.usd;
}

/**
 * Les dossiers à traiter d'abord : ceux qui viennent d'être votés dans leur
 * ensemble à l'Assemblée (les fiches les plus ouvertes), puis ceux qui ont bougé
 * récemment.
 */
async function prioritaires(): Promise<string[]> {
  const depuis = new Date(Date.now() - 400 * 86400000).toISOString();
  const { data: sc } = await supabase.from("scrutins").select("id").eq("type", "LOI").ilike("title", "l'ensemble%")
    .gte("date_scrutin", depuis).order("date_scrutin", { ascending: false }).limit(60);
  const { data: liens } = await supabase.from("legislative_scrutins").select("dossier_id").in("official_id", (sc || []).map((s: any) => s.id));
  const { data: recents } = await supabase.from("legislative_dossiers").select("id").eq("current_chamber", "AN")
    .gte("latest_step_at", new Date(Date.now() - 45 * 86400000).toISOString()).order("latest_step_at", { ascending: false }).limit(60);
  return [...new Set([...(liens || []).map((l: any) => l.dossier_id), ...(recents || []).map((r: any) => r.id)].filter(Boolean))];
}

/**
 * --mesurer : lit les vrais documents SANS appeler le modèle, et compte le volume
 * que chaque dossier enverrait (entrée) et recevrait (sortie, estimée large : le
 * modèle raisonne avant de répondre). Sert à chiffrer une campagne avant de payer.
 */
async function mesurer(ids: string[]) {
  const TOK = 3.3; // caractères par token, français
  let n = 0, lisibles = 0, entree = 0, sortie = 0;
  for (const id of ids) {
    const { data: d } = await supabase.from("legislative_dossiers").select("title, short_title, source_urls").eq("id", id).maybeSingle();
    if (!d) continue;
    n++;
    const docs = await documents(d.source_urls || []);
    if (!docs?.final) { console.log(`  —  illisible : ${(d.short_title || d.title).slice(0, 60)}`); continue; }
    lisibles++;
    const E = (docs.initial ? exposeDesMotifs(docs.initial.texte) : exposeDesMotifs(docs.final.texte)).length;
    const parts = tranches(docs.final.texte);
    const inChars = parts.reduce((s, p) => s + Math.min(E, 15000) + p.length + 3000, 0)
      + E + Math.min(docs.final.texte.length, 250000) + 3000
      + (docs.etude ? droitExistant(docs.etude.texte).length : 0) + Math.min(E, 15000) + 17500 + 2000;
    const inTok = inChars / TOK, outTok = parts.length * 6000 + 6000 + 4000;
    entree += inTok; sortie += outTok;
    console.log(`  ${String(Math.round(docs.final.texte.length / 1000)).padStart(4)}k car. · ${parts.length} tranche(s) · étude ${docs.etude ? "oui" : "non"} · ≈${Math.round(inTok / 1000)}k tok entrée : ${(d.short_title || d.title).slice(0, 55)}`);
  }
  console.log(`\n${lisibles}/${n} lisibles · moyenne par dossier lisible : ${Math.round(entree / lisibles / 1000)}k tokens entrée, ${Math.round(sortie / lisibles / 1000)}k sortie`);
}

/** Toutes les lignes d'une requête, par pages de 1 000. */
async function toutes<T>(requete: (de: number, a: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const sortie: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await requete(de, de + 999);
    if (!data?.length) break;
    sortie.push(...data);
    if (data.length < 1000) break;
  }
  return sortie;
}

/**
 * Les dossiers à traiter : les prioritaires d'abord, puis (--depuis) tous ceux qui
 * ont bougé dans la période, du plus récent au plus ancien. On écarte ceux déjà
 * analysés par la méthode actuelle et ceux sans texte lisible essayés il y a moins
 * de 7 jours : une campagne reprend là où la précédente s'est arrêtée.
 */
async function candidats(): Promise<string[]> {
  let ids = await prioritaires();
  if (DEPUIS > 0) {
    const depuis = new Date(Date.now() - DEPUIS * 86400000).toISOString();
    const periode = await toutes<{ id: string }>((de, a) => supabase.from("legislative_dossiers").select("id")
      .gte("latest_step_at", depuis).order("latest_step_at", { ascending: false }).range(de, a));
    ids = [...new Set([...ids, ...periode.map(p => p.id)])];
  }
  if (FORCE) return ids;
  const faits = new Set((await toutes<{ dossier_id: string }>((de, a) => supabase.from("dossier_analyses_approfondies")
    .select("dossier_id").eq("model", VERSION).range(de, a))).map(r => r.dossier_id));
  const recemment = new Date(Date.now() - 7 * 86400000).toISOString();
  const essayes = new Set((await toutes<{ dossier_id: string }>((de, a) => supabase.from("dossier_analyses_tentatives")
    .select("dossier_id").gte("tente_le", recemment).range(de, a))).map(r => r.dossier_id));
  // En campagne, un dossier déjà fait est sauté sans relire ses PDF. Hors campagne, les
  // prioritaires sont revus : leur texte a pu changer (commission, séance, Sénat).
  return ids.filter(id => !essayes.has(id) && (DEPUIS === 0 || !faits.has(id)));
}

async function soldeDeepSeek(): Promise<boolean> {
  try {
    const r = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, signal: AbortSignal.timeout(15000),
    });
    const j = (await r.json()) as { is_available?: boolean; balance_infos?: { total_balance?: string }[] };
    console.log(`  Solde DeepSeek : ${j.balance_infos?.[0]?.total_balance ?? "?"} $`);
    return j.is_available !== false;
  } catch { return true; }
}

async function main() {
  const ids = UN_DOSSIER ? [UN_DOSSIER] : await candidats();
  if (args.includes("--mesurer")) return mesurer(ids);
  console.log(`  ${ids.length} dossier(s) à analyser${DEPUIS ? ` (actifs depuis ${DEPUIS} jours, hors déjà faits)` : ""}`);
  if (PAYANT && !(await soldeDeepSeek())) {
    console.log("--- Solde DeepSeek épuisé : campagne en attente d'une recharge (platform.deepseek.com/top_up). ---");
    return;
  }
  console.log(`--- ANALYSES APPROFONDIES${PAYANT ? " (DeepSeek payant)" : ""} : ${ids.length} dossier(s) à voir, ${MAX} au plus${BUDGET ? `, ${BUDGET} $ au plus` : ""}, ${PARALLELE} en parallèle ---`);

  // Plusieurs dossiers à la fois : chacun passe une à deux minutes à attendre le
  // modèle. Les plafonds (nombre, budget) sont vérifiés avant chaque dossier.
  let faits = 0, depense = 0, suivant = 0, arret = "";
  const travailleur = async () => {
    while (!arret && suivant < ids.length && faits < MAX && (!BUDGET || depense < BUDGET)) {
      const id = ids[suivant++];
      const { data: d } = await supabase.from("legislative_dossiers").select("id, title, short_title, source_urls").eq("id", id).maybeSingle();
      if (!d) continue;
      try {
        const cout = await analyser(d as any);
        if (cout !== null) { faits++; depense += cout; }
      } catch (e: any) {
        console.warn(`  ! ${d.short_title || d.title} : ${e.message}`);
        if (ARRET.test(e.message)) arret = e.message;
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLELE }, travailleur));

  if (arret) console.warn(`  Arrêt : ${arret} Reprise au prochain passage.`);
  if (BUDGET && depense >= BUDGET) console.log(`  Plafond du passage atteint (${BUDGET} $).`);
  const reste = Math.max(0, ids.length - suivant);
  console.log(`--- TERMINÉ : ${faits} analyse(s) écrite(s)${PAYANT ? `, ${DEPENSE_TOTALE.toFixed(3)} $ facturés (échecs compris)` : ""}, ${reste} dossier(s) restant(s) ---`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
