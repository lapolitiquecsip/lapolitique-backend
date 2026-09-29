import "dotenv/config";
import pdf from "pdf-parse/lib/pdf-parse.js";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

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

const args = process.argv.slice(2);
const opt = (n: string) => args.find(a => a.startsWith(`--${n}=`))?.split("=")[1];
const FORCE = args.includes("--force");
const MAX = Number(opt("max") || 6);
const UN_DOSSIER = opt("dossier");
const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitiquecestsimple.fr)" };
const AN = "https://www.assemblee-nationale.fr";
// Version de la méthode : une analyse écrite par une méthode plus ancienne est refaite.
const VERSION = "approfondie-v2 (tranches d'articles)";

const propre = (t: string) => t
  .replace(/ /g, " ")
  .replace(/–\s*\d+\s*–/g, " ")          // numéros de page « – 3 – »
  .replace(/[ \t]+/g, " ")
  .replace(/\s*\n\s*/g, "\n")
  .replace(/\n{2,}/g, "\n")
  .trim();

async function lirePdf(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(60000) });
    if (!r.ok || !/pdf/i.test(r.headers.get("content-type") || "")) return null;
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
  const page = sourceUrls.find(u => /assemblee-nationale\.fr\/dyn\/\d+\/dossiers\//.test(u));
  if (!page) return null;
  const html = await fetch(page, { headers: UA, signal: AbortSignal.timeout(30000) }).then(r => (r.ok ? r.text() : "")).catch(() => "");
  const ids = [...new Set([...html.matchAll(/\/dyn\/(\d+)\/textes\/(l\d+[bt]\d+_[a-z-]+)/g)].map(m => `${m[1]}|${m[2]}`))]
    .map(x => { const [leg, id] = x.split("|"); return { leg, id, num: Number(id.match(/l\d+[bt](\d+)/)?.[1] || 0), t: id.includes("t") && /^l\d+t/.test(id) }; });
  if (!ids.length) return null;
  const pdfUrl = (x: { leg: string; id: string }) => `${AN}/dyn/${x.leg}/textes/${x.id}.pdf`;

  const par = (re: RegExp) => ids.filter(x => re.test(x.id)).sort((a, b) => b.num - a.num);
  const final = par(/_texte-adopte-seance$|_texte-adopte$/)[0] || par(/_texte-adopte-commission$/)[0]
    || par(/_(projet|proposition)-loi(-organique)?$/)[0];
  const initial = par(/_(projet|proposition)-loi(-organique)?$/).slice(-1)[0];
  const etude = par(/_etude-impact$/).slice(-1)[0];
  if (!final) return null;

  const [tf, ti, te] = await Promise.all([
    lirePdf(pdfUrl(final)),
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

/** Un appel au modèle qui doit rendre du JSON ; un JSON mal formé est redemandé ; un quota saturé attend que les modèles écartés 5 min reviennent. */
async function demanderJson(systeme: string, contenu: string, maxTokens: number): Promise<any> {
  let derniere: any;
  for (let essai = 1; essai <= 4; essai++) {
    try {
      const r = await resilientDeepSeek.createMessage({
        model: "deepseek-chat", max_tokens: maxTokens, responseFormat: "json_object",
        system: systeme, messages: [{ role: "user", content: contenu }],
      }, { timeoutMs: 240000 });
      const texte = r.content?.[0]?.type === "text" ? r.content[0].text : "";
      const m = texte.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("réponse sans JSON");
      return JSON.parse(m[0]);
    } catch (e) {
      derniere = e;
      // Plus aucun modèle disponible : quota du JOUR épuisé, inutile d'attendre.
      if (/Aucun modèle gratuit disponible/.test(String((e as Error).message))) throw e;
      console.warn(`    ! essai ${essai}/4 : ${(e as Error).message}`);
      await pause(essai === 1 && !/JSON/.test(String((e as Error).message)) ? 330000 : 30000 * essai);
    }
  }
  throw derniere;
}

const SYSTEME_MESURES = `Tu es juriste et pédagogue. On te donne UN EXTRAIT du texte d'une loi (une suite d'articles complets) et son exposé des motifs.
Décris TOUTES les mesures contenues dans CET EXTRAIT, en français clair : après t'avoir lu, le lecteur sait exactement ce que ces articles changent, sans ouvrir le texte.

RÈGLES
- Uniquement ce que disent les documents. Aucune information extérieure, aucun chiffre inventé.
- EXHAUSTIVITÉ : un article long contient souvent plusieurs mesures distinctes (un I, un II, des 1°, 2°…) : fais une mesure par changement réel. Ne saute aucune disposition qui change quelque chose pour quelqu'un. Seules les coordinations purement rédactionnelles peuvent être ignorées.
- "article" : le numéro EXACTEMENT tel qu'il figure dans l'extrait (« Art. 5 », « Art. 5, II »). N'invente pas de « bis ».
- "avant" : ce qui s'appliquait jusqu'ici, UNIQUEMENT si l'extrait ou l'exposé des motifs le dit ; sinon chaîne vide.
- "apres" et "detail" : le nouveau droit, avec TOUS les chiffres exacts (âges, durées, délais, montants, seuils, peines), les conditions et les exceptions.
- Français courant ; un terme juridique inévitable s'explique entre parenthèses. Aucun jugement de valeur.

FORMAT — un objet JSON :
{ "mesures": [{"titre": "titre court et concret", "article": "Art. 3", "avant": "…", "apres": "…", "detail": "2 à 6 phrases concrètes, chiffres compris", "qui": "qui est concerné"}] }`;

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
  "chiffres_cles": [{"valeur": "…", "libelle": "…"}],
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

async function analyser(d: { id: string; title: string; short_title: string | null; source_urls: string[] }) {
  const docs = await documents(d.source_urls || []);
  if (!docs?.final) { console.log(`  · ${d.short_title || d.title} : aucun texte lisible à l'Assemblée`); return false; }

  if (!FORCE) {
    const { data: deja } = await supabase.from("dossier_analyses_approfondies").select("texte_version, model").eq("dossier_id", d.id).maybeSingle();
    if (deja?.texte_version === docs.version && deja?.model === VERSION) { console.log(`  · déjà à jour (${docs.version}) : ${d.short_title || d.title}`); return false; }
  }

  const titre = d.short_title || d.title;
  const expose = docs.initial ? exposeDesMotifs(docs.initial.texte) : exposeDesMotifs(docs.final.texte);
  console.log(`  · ${titre} — texte ${docs.version} : ${docs.final.texte.length} car.${docs.etude ? `, étude d'impact ${docs.etude.texte.length} car.` : ""}`);

  // 1. Les mesures, tranche d'articles par tranche : rien n'est coupé.
  const parts = tranches(docs.final.texte);
  const mesures: any[] = [];
  for (const [k, part] of parts.entries()) {
    const r = await demanderJson(SYSTEME_MESURES,
      `LOI : ${d.title}\n\nEXPOSÉ DES MOTIFS (pour le contexte) :\n${expose.slice(0, 15000)}\n\nEXTRAIT ${k + 1}/${parts.length} DU TEXTE ADOPTÉ :\n${part}`, 16000);
    mesures.push(...(Array.isArray(r.mesures) ? r.mesures : []));
    console.log(`    tranche ${k + 1}/${parts.length} : ${(r.mesures || []).length} mesures`);
    await pause(15000); // quotas par minute des modèles gratuits
  }
  // 2. La vue d'ensemble, sur le texte entier.
  const analyse = await demanderJson(SYSTEME_ANALYSE,
    `LOI : ${d.title}\n\nEXPOSÉ DES MOTIFS :\n${expose}\n\nTEXTE ADOPTÉ (${docs.final.titre}) :\n${docs.final.texte.slice(0, 250000)}`, 12000);
  analyse.mesures = mesures;

  // Fiches pratiques du même domaine : ce que le droit prévoit déjà, en clair.
  const requete = titre.replace(/\b(loi|projet|proposition|visant|relative?|relatif|portant|à|au|aux|des|les|la|le|de|du|et|pour)\b/gi, " ").replace(/\s+/g, " ").trim();
  const { data: fiches } = await supabase.rpc("search_fiches_pratiques", { q: requete, lim: 5 });
  const fichesTexte = (fiches || []).map((f: any) => `« ${f.title} » (${f.url})\n${String(f.body || "").slice(0, 3500)}`).join("\n\n");

  let cadre: any = null;
  try {
    cadre = await demanderJson(SYSTEME_CADRE,
      `LOI : ${d.title}\n\n${docs.etude ? `ÉTUDE D'IMPACT — état du droit :\n${droitExistant(docs.etude.texte)}\n\n` : ""}EXPOSÉ DES MOTIFS :\n${expose.slice(0, 15000)}\n\nFICHES PRATIQUES :\n${fichesTexte || "(aucune)"}`, 6000);
    // Les liens, eux, viennent des fiches et jamais du modèle.
    cadre.fiches = (fiches || []).map((f: any) => ({ titre: f.title, url: f.url }));
    const vus = new Set<string>();
    cadre.textes = (fiches || []).flatMap((f: any) => f.refs || [])
      .filter((r: any) => r.url && !vus.has(r.url) && vus.add(r.url))
      .slice(0, 12).map((r: any) => ({ titre: r.titre, url: r.url }));
  } catch (e: any) {
    console.warn(`    ! cadre existant : ${e.message}`);
  }

  const sources = [docs.final, docs.initial, docs.etude].filter(Boolean).map(x => ({ titre: x!.titre, url: x!.url }));
  const { error } = await supabase.from("dossier_analyses_approfondies").upsert({
    dossier_id: d.id, analyse_loi: analyse, cadre, sources, texte_version: docs.version,
    model: VERSION, generated_at: new Date().toISOString(),
  }, { onConflict: "dossier_id" });
  if (error) throw error;
  console.log(`    ✓ ${(analyse.mesures || []).length} mesures, ${(analyse.chiffres_cles || []).length} chiffres${cadre ? `, cadre : ${(cadre.dispositifs || []).length} dispositifs` : ""}`);
  return true;
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

async function main() {
  const ids = UN_DOSSIER ? [UN_DOSSIER] : await prioritaires();
  console.log(`--- ANALYSES APPROFONDIES : ${ids.length} dossier(s) candidat(s), ${MAX} au plus ---`);
  let faits = 0;
  for (const id of ids) {
    if (faits >= MAX) break;
    const { data: d } = await supabase.from("legislative_dossiers").select("id, title, short_title, source_urls").eq("id", id).maybeSingle();
    if (!d) continue;
    try { if (await analyser(d as any)) faits++; }
    catch (e: any) {
      console.warn(`  ! ${d.short_title || d.title} : ${e.message}`);
      if (/Aucun modèle gratuit disponible/.test(e.message)) { console.warn("  Quota gratuit du jour épuisé : reprise au prochain passage."); break; }
    }
  }
  console.log(`--- TERMINÉ : ${faits} analyse(s) écrite(s) ---`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
