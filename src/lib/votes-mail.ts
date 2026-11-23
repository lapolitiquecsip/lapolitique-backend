import { supabase } from "../config/supabase.js";
import { resilientDeepSeek, DEEPSEEK_FLASH } from "./deepseek-client.js";
import { texteDecode } from "./decodage.js";
import { esc, COULEURS, SITE_URL } from "./mail.js";

/**
 * Rubrique « Vos élus ont voté » des e-mails, regroupée (demande de l'éditeur, 17/11/2026).
 *
 * Avant : une ligne par vote et par élu. Pendant le budget de la Sécurité sociale, un sénateur
 * vote cinquante fois par jour (amendements, articles) : l'e-mail alignait trente lignes
 * « X a voté CONTRE au Sénat » suivies de l'intitulé officiel, illisibles.
 *
 * Désormais :
 *   - un bloc par TEXTE (« Projet de loi de financement de la sécurité sociale pour 2027 »),
 *     avec le bilan de chaque élu suivi (« 7 pour, 5 contre ») ;
 *   - quelques votes détaillés seulement (l'ensemble du texte, les articles, puis les
 *     amendements adoptés), chacun une seule fois même si plusieurs élus suivis l'ont voté ;
 *   - sous chaque vote, ce qu'il y avait dedans : le but de l'amendement (exposé de ses auteurs,
 *     sans IA) et, quand un article existant est en jeu, ce que prévoit cet article — expliqué
 *     par l'IA à partir du TEXTE OFFICIEL de l'article (Sénat / Assemblée), mis en cache dans
 *     digest_enrichissements (clé « article:… ») pour ne l'expliquer qu'une fois ;
 *   - le reste en un lien vers la fiche de l'élu.
 * Rien n'est inventé : sans texte officiel lisible, pas d'explication de l'article.
 */

type Alerte = {
  id?: string; title?: string | null; detail?: string | null; position?: string | null; scrutin_id?: string | null;
  senator_id?: string | null; deputy_id?: string | null; mep_id?: string | null; event_at?: string | null; url?: string | null;
};
type Chambre = "SENAT" | "AN" | "PE";
type Nature = "ensemble" | "partie" | "motion" | "article" | "amendement" | "autre";
type Amdt = { numero: string; texte_uid: string | null; texte_titre: string | null; division: string | null; expose: string | null; auteur: string | null; groupe: string | null; url: string | null; scrutin_id: string };
type Vote = {
  cle: string; chambre: Chambre; titre: string; date: string | null; source: string | null;
  resultat: { adopte: boolean | null; pour: number | null; contre: number | null; abstention: number | null } | null;
  amendements: Amdt[]; elus: Map<string, string>; nature: Nature; article: string | null; texte: string; dossier: string | null;
};

const COULEUR_POS: Record<string, string> = { POUR: "#059669", CONTRE: "#e11d48", ABSTENTION: "#d97706" };
const MOT_POS: Record<string, string> = { POUR: "pour", CONTRE: "contre", ABSTENTION: "abstention" };
const CHAMBRE: Record<Chambre, string> = { SENAT: "Sénat", AN: "Assemblée nationale", PE: "Parlement européen" };

/**
 * Secours quand aucun vote du texte n'est rattaché à un dossier (projet de loi « relance et
 * décentralisation du logement », 17/11/2026) : la fiche du site retrouvée par les mots
 * distinctifs de l'intitulé, dans l'ordre (« %relance%décentralisation%logement% »).
 */
const cacheDossiers = new Map<string, string | null>();
async function dossierParTitre(texte: string): Promise<string | null> {
  if (!texte || /^autres votes$/i.test(texte)) return null;
  if (cacheDossiers.has(texte)) return cacheDossiers.get(texte)!;
  const coeur = texte.replace(/^(projet|proposition) de loi( organique| constitutionnelle)?(,[^,]*,)?\s*/i, "");
  const mots = coeur.split(/[\s'’,«»()]+/).filter(m => m.length > 4 && !/^(visant|relative|relatif|portant|concernant|dans|leurs|cette|entre|notamment)$/i.test(m)).slice(0, 4);
  let id: string | null = null;
  if (mots.length >= 2) {
    const { data } = await supabase.from("legislative_dossiers").select("id").ilike("title", `%${mots.join("%")}%`)
      .order("latest_step_at", { ascending: false, nullsFirst: false }).limit(1);
    id = data?.[0]?.id ?? null;
  }
  cacheDossiers.set(texte, id);
  return id;
}

const propre = (s: string | null | undefined) => String(s ?? "").replace(/\\[rn]|[\r\n]/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ").trim();
const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ───────────────────────── Lecture des intitulés officiels ───────────────────────── */

const TEXTE = /\s+(?:du|de la|de l['’]|au|à la|à l['’])\s*((?:projet|proposition)\s+de\s+(?:loi|r[ée]solution)(?:\s+organique|\s+constitutionnelle)?\b.*)$/i;

/** Le texte voté, tiré de l'intitulé : « projet de loi de financement de la sécurité sociale pour 2027 ». */
export function texteDuScrutin(titre: string): string | null {
  const m = TEXTE.exec(propre(titre));
  if (!m) return null;
  return m[1].replace(/\s*\((premi[eè]re|deuxi[eè]me|nouvelle|seconde|troisi[eè]me) lecture\)\.?\s*$/i, "").replace(/\s*\([^)]*\)\s*\.?$/, "").replace(/[\s.]+$/, "").trim();
}

const NUM_ART = String.raw`(premier|1er|\d+)(?:\s*er)?(?:\s+(bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies))?(?:\s+([A-Z])\b)?`;
/** « premier » / « 1er » → « 1 » ; « 7 bis A » gardé tel quel. */
const normArticle = (n: string, suffixe?: string, lettre?: string) =>
  [/^(premier|1er)$/i.test(n) ? "1" : n, suffixe?.toLowerCase(), lettre].filter(Boolean).join(" ");

/** L'article EXISTANT sur lequel porte le vote, s'il y en a un (pas un article additionnel ni rétabli). */
export function articleVise(titre: string, amdt?: Amdt | null): string | null {
  const div = propre(amdt?.division);
  if (div) {
    if (/additionnel|avant l|apr[eè]s l/i.test(div)) return null;
    const d = new RegExp(`^Article\\s+${NUM_ART}`, "i").exec(div);
    if (d) return normArticle(d[1], d[2], d[3]);
  }
  const tete = propre(titre).split(TEXTE)[0];
  const re = new RegExp(`(\\S+\\s+)?l['’]article\\s+${NUM_ART}`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(tete))) {
    const avant = (m[1] || "").toLowerCase();
    if (/apr[eè]s|avant|r[ée]tablissement/.test(avant)) continue;
    if (/r[ée]tabli|ins[ée]rer un article/.test(tete.slice(Math.max(0, m.index - 40), m.index))) continue;
    return normArticle(m[2], m[3], m[4]);
  }
  return null;
}

function natureDe(titre: string): Nature {
  const t = propre(titre).replace(/^sur\s+/i, "");
  if (/^(l['’]ensemble de )?la (premi[eè]re|seconde|deuxi[eè]me|troisi[eè]me|quatri[eè]me) partie/i.test(t)) return "partie";
  if (/^l['’]ensemble/i.test(t)) return "ensemble";
  if (/motion|d[ée]claration du gouvernement/i.test(t.slice(0, 60))) return "motion";
  if (/^(l['’]|le |les )?(sous-)?amendements?/i.test(t)) return "amendement";
  if (/^(l['’]article|les articles)/i.test(t)) return "article";
  return "autre";
}

/** Intitulé court d'un vote (l'intitulé officiel entier reste sur la page source). */
function libelle(v: Vote): string {
  const t = propre(v.titre).replace(/^sur\s+/i, "");
  const tete = t.split(TEXTE)[0].replace(/[\s,]+$/, "");
  switch (v.nature) {
    case "ensemble": return "Vote sur l'ensemble du texte";
    case "partie": return majuscule(tete.replace(/^l['’]ensemble de /i, "Ensemble de "));
    case "article": return majuscule(tete.replace(/^l['’]/i, ""));
    case "motion": {
      const genre = /question pr[ée]alable/i.test(tete) ? "Question préalable" : /rejet pr[ée]alable/i.test(tete) ? "Motion de rejet préalable"
        : /renvoi en commission/i.test(tete) ? "Motion de renvoi en commission" : /censure/i.test(tete) ? "Motion de censure" : null;
      const par = /(?:pr[ée]sent[ée]e|d[ée]pos[ée]e) par (M\.|Mme) ([^,]+?)(?= et | au nom|,|$)/i.exec(tete)?.slice(1).join(" ");
      return genre ? `${genre}${par ? ` · ${par}` : ""}` : majuscule(tete).replace(/[\s,]+$/, "").slice(0, 140);
    }
    case "amendement": {
      const a = v.amendements[0];
      const sous = /^(l['’]|le |les )?sous-amendement/i.test(t);
      const identiques = /identiques/i.test(tete) ? Math.max(v.amendements.length, (tete.match(/n°/g) || []).length) : 1;
      const numero = a?.numero || /n°\s*([\w-]+)/i.exec(tete)?.[1] || "";
      const auteur = a?.auteur || /pr[ée]sent[ée]e? par (M\.|Mme) ([^,]+?)(?= et | au nom|,|$)/i.exec(tete)?.slice(1).join(" ")
        || /n°\s*[\w-]+(?:\s*\([^)]*\))?\s+de (M\.|Mme) ([^,]+?)(?= à | après | avant | de r| et |,|$)/i.exec(tete)?.slice(1).join(" ") || "";
      const groupe = a?.groupe && !/^(gouvernement|commission)/i.test(a.groupe) ? ` (${a.groupe})` : "";
      return `${sous ? "Sous-amendement" : "Amendement"}${numero ? ` n° ${numero}` : ""}${identiques > 1 ? ` et ${identiques - 1} identique${identiques > 2 ? "s" : ""}` : ""}${auteur ? ` · ${auteur}${groupe}` : ""}`;
    }
    default: return majuscule(tete).slice(0, 160);
  }
}

/** Où porte le vote, en clair : « Article additionnel après l'article 7 », « Suppression de l'article 35 ». */
function cible(v: Vote): string | null {
  if (v.nature !== "amendement") return null;
  const tete = propre(v.titre).split(TEXTE)[0];
  if (/tendant [àa] supprimer l['’]article/i.test(tete)) return `Suppression de l'article ${v.article ?? ""}`.trim();
  const div = propre(v.amendements[0]?.division);
  if (div) return majuscule(div.replace(/^Article PREMIER/i, "Article 1er")) + (!/article/i.test(div) && v.article ? ` de l'article ${v.article}` : "");
  const m = /(?:tendant [àa] ins[ée]rer un article additionnel |de r[ée]tablissement de |[àa] )(?:(apr[eè]s|avant) )?l['’]article\s+([^,]+?)(?=\s+(?:du|de la)\s+(?:projet|proposition)|,|$)/i.exec(tete);
  if (!m) return null;
  if (/additionnel/i.test(m[0])) return `Article additionnel ${m[1]} l'article ${m[2]}`;
  if (/r[ée]tablissement/i.test(m[0])) return `Rétablissement de l'article ${m[2]}`;
  return `Article ${m[2]}`;
}

/** Ce que signifie un vote de procédure (sans IA : règles constitutionnelles et organiques). */
function sensProcedure(v: Vote): string | null {
  const t = propre(v.titre);
  if (v.nature === "motion") {
    if (/question pr[ée]alable|rejet pr[ée]alable/i.test(t)) return "Adoptée, elle aurait rejeté le texte d'emblée, sans examen de ses articles.";
    if (/renvoi en commission/i.test(t)) return "Adoptée, elle aurait renvoyé le texte en commission, suspendant son examen en séance.";
    if (/censure/i.test(t)) return "Adoptée à la majorité absolue des députés, elle aurait fait tomber le gouvernement.";
    return null;
  }
  if (v.nature !== "partie") return null;
  const an = Number(/pour (\d{4})/.exec(v.texte)?.[1]);
  const rang = /premi[eè]re/i.test(t) ? 1 : /seconde|deuxi[eè]me/i.test(t) ? 2 : /troisi[eè]me/i.test(t) ? 3 : /quatri[eè]me/i.test(t) ? 4 : 0;
  if (/financement de la s[ée]curit[ée] sociale/i.test(v.texte) && an && rang) return [
    `Elle arrête les comptes de la Sécurité sociale de ${an - 2}, année close.`,
    `Elle rectifie le budget de la Sécurité sociale de l'année en cours (${an - 1}).`,
    `Elle fixe les recettes de la Sécurité sociale pour ${an} (cotisations, CSG, exonérations…) et son équilibre général.`,
    `Elle fixe les dépenses de la Sécurité sociale pour ${an} (santé, retraites, famille, autonomie…).`,
  ][rang - 1];
  if (/loi de finances/i.test(v.texte) && rang === 1) return "Elle fixe les recettes de l'État (impôts, taxes) et l'équilibre du budget ; son rejet arrête l'examen du texte.";
  if (/loi de finances/i.test(v.texte) && rang === 2) return "Elle fixe les dépenses de l'État, mission par mission.";
  return null;
}

/** Le but de l'amendement, dans les mots de ses auteurs : la phrase « Cet amendement vise à… ».
 *  `direct` = faux quand l'exposé n'a pas cette phrase : on cite alors son début, présenté comme tel. */
export function butAmendement(expose: string | null | undefined): { texte: string; direct: boolean } | null {
  const t = propre(expose).replace(/^(objet|expos[ée] sommaire)\s*:?\s*/i, "");
  if (t.length < 20) return null;
  const phrases = t.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÝÉ«])/);
  let i = phrases.findIndex(s => /\b(cet|le pr[ée]sent|ces|notre|le|du pr[ée]sent) (sous-)?amendements?\b/i.test(s) && !/amendements? n°/i.test(s));
  if (i < 0) i = phrases.findIndex(s => /\b(il est (donc )?propos[ée]|nous proposons|les auteurs|c['’]est pourquoi|le pr[ée]sent dispositif)\b/i.test(s));
  const direct = i >= 0;
  let p = phrases[Math.max(0, i)];
  // « Cet amendement propose sa suppression. » : la phrase d'avant dit de quoi.
  if (direct && i > 0 && p.length < 90) p = `${phrases[i - 1]} ${p}`;
  return { texte: p.length > 340 ? `${p.slice(0, 330).replace(/\s+\S*$/, "")}…` : p, direct };
}

/* ───────────────────────── Texte officiel d'un article ───────────────────────── */

const pages = new Map<string, Promise<string | null>>();

async function lireTexte(url: string): Promise<string | null> {
  if (!pages.has(url)) pages.set(url, (async () => {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)" }, signal: AbortSignal.timeout(45000) });
      if (!r.ok) return null;
      const html = await texteDecode(r);
      return html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
        .replace(/<\/?(p|div|h\d|br|li|tr|td|table|section|article|blockquote)\b[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;|&#160;/g, " ").replace(/&#8217;|&rsquo;/g, "’").replace(/&laquo;/g, "«").replace(/&raquo;/g, "»")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
        .replace(/[-]/g, "")   // numéros d'alinéa du Sénat (police à symboles)
        .replace(/[ \t   ]+/g, " ").replace(/\n\s*\n+/g, "\n");
    } catch { return null; }
  })());
  return pages.get(url)!;
}

/** Le texte de l'article demandé (le plus long passage sous son intitulé : le sommaire est écarté). */
export function extraireArticle(texte: string, article: string): string | null {
  const lignes = texte.split("\n").map(l => l.trim());
  const entete = new RegExp(`^Article\\s+${NUM_ART}\\s*$`, "i");
  const autreTitre = /^(Articles?\s+(premier|1er|\d+)|TITRE\b|CHAPITRE\b|Section\s+\d|ANNEXE|[ÉE]TAT [A-G]\b|Délibéré en|Fait à Paris)/i;
  let meilleur: string | null = null;
  for (let i = 0; i < lignes.length; i++) {
    const m = entete.exec(lignes[i]);
    if (!m || normArticle(m[1], m[2], m[3]) !== article) continue;
    const corps: string[] = [];
    for (let j = i + 1; j < lignes.length && !autreTitre.test(lignes[j]); j++) corps.push(lignes[j]);
    const t = corps.join("\n").trim();
    if (!meilleur || t.length > meilleur.length) meilleur = t;
  }
  if (!meilleur || meilleur.replace(/\((non modifi[ée]|supprim[ée]|conforme|pour coordination)\)/gi, "").replace(/[\s.–-]/g, "").length < 40) return null;
  return meilleur;
}

/** Adresses possibles du texte en discussion, d'après un amendement déposé dessus. */
function adressesDuTexte(chambre: Chambre, a: Amdt): string[] {
  if (chambre === "AN" && a.texte_uid) return [`https://www.assemblee-nationale.fr/dyn/opendata/${a.texte_uid.replace(/P\d+D\d+$/, "")}.html`];
  const m = /amendements\/(\d{4})-\d{4}\/(\d+)\//.exec(a.url || "");
  if (chambre === "SENAT" && m) {
    const an = m[1].slice(2);
    const pref = /proposition/i.test(a.texte_titre || "") ? ["ppl", "pjl"] : ["pjl", "ppl"];
    return pref.map(p => `https://www.senat.fr/leg/${p}${an}-${m[2]}.html`);
  }
  return [];
}

const REFUS = /(je ne peux|n['’]a pas été fourni|impossible|texte (n['’]est pas|non) (fourni|disponible)|pas d['’]information|insuffisant)/i;
const ETRANGER = /[぀-ヿ㐀-䶿一-鿿가-힯Ѐ-ӿ]/;
let payantsRestants = Number(process.env.VOTES_MAIL_IA_PAYANT_MAX || 40);

/** « Cet article crée… » : explication d'un article à partir de son texte officiel, une fois pour toutes. */
async function expliquerArticle(chambre: Chambre, texteNom: string, a: Amdt, article: string): Promise<{ texte: string; url: string } | null> {
  const adresses = adressesDuTexte(chambre, a);
  if (!adresses.length) return null;
  const cle = `article:${chambre}:${a.texte_uid || adresses[0]}:${article}`;
  const { data: deja } = await supabase.from("digest_enrichissements").select("contenu").eq("cle", cle).maybeSingle();
  if (deja) return deja.contenu?.texte ? deja.contenu : null;

  let corps: string | null = null; let url = "";
  for (const u of adresses) {
    const page = await lireTexte(u);
    if (page && (corps = extraireArticle(page, article))) { url = u; break; }
  }
  if (!corps) {
    // Texte lisible mais article absent (supprimé, renuméroté) : on le note pour ne pas relire la page à chaque envoi.
    if ((await Promise.all(adresses.map(lireTexte))).some(Boolean)) await supabase.from("digest_enrichissements").upsert({ cle, contenu: null, modele: "aucun" });
    return null;
  }
  const params = {
    model: DEEPSEEK_FLASH, max_tokens: 1500, sansReflexion: true,
    system: `Tu expliques à un citoyen non spécialiste ce que prévoit un article d'un texte de loi français, à partir de son TEXTE OFFICIEL fourni.
Réponds par une ou deux phrases simples (55 mots au plus), dont le sujet est « Cet article » (ex. : « Cet article crée une contribution des employeurs sur… »).
- Uniquement d'après le texte fourni : aucun fait, chiffre ou date qui n'y figure pas. Les chiffres importants du texte peuvent être repris.
- Dis concrètement ce qui change et pour qui ; traduis le jargon (« assiette », « exonération ») ; pas de numéros d'articles de codes.
- Neutre : aucun jugement, aucun adjectif de valeur.
Réponds uniquement par l'explication, sans guillemets ni préfixe.`,
    messages: [{ role: "user" as const, content: `Texte : ${texteNom}\nArticle ${article} — texte officiel :\n${corps.slice(0, 9000)}` }],
  };
  let sortie = "";
  let modele = "gratuit";
  // Sans clé gratuite, le client passerait DeepSeek en « primaire » et quitterait le processus à solde nul :
  // on va alors directement au payant, qui lève une erreur au lieu de couper l'envoi des e-mails.
  try {
    if (!(process.env.LLM_FREE_API_KEY || process.env.GEMINI_API_KEY)) throw new Error("pas de clé gratuite");
    sortie = (await resilientDeepSeek.createMessage(params, { timeoutMs: 60000 })).content?.[0]?.text ?? "";
  } catch {
    if (payantsRestants-- > 0) {
      try { sortie = (await resilientDeepSeek.createMessage(params, { timeoutMs: 60000, payant: true })).content?.[0]?.text ?? ""; modele = DEEPSEEK_FLASH; }
      catch (e: any) { console.warn(`[Votes] article ${article} non expliqué : ${e?.message}`); }
    }
  }
  const explication = propre(sortie).replace(/^[«"]\s*|\s*[»"]$/g, "");
  if (explication.length < 25 || explication.length > 600 || REFUS.test(explication) || ETRANGER.test(explication)) return null;   // pas de cache : retenté au prochain envoi
  const contenu = { texte: explication, url, article };
  await supabase.from("digest_enrichissements").upsert({ cle, contenu, sources: [url], modele });
  return contenu;
}

/* ───────────────────────── Assemblage ───────────────────────── */

async function parTranches<T>(ids: string[], lire: (lot: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...await lire(ids.slice(i, i + 150)));
  return out;
}

const chambreDe = (a: Alerte): Chambre => (a.senator_id || /au S[ée]nat/.test(a.detail || "") ? "SENAT" : a.mep_id || /Parlement europ/.test(a.detail || "") ? "PE" : "AN");
const nomDe = (a: Alerte) => /^(.*?)\s+a vot[ée]/.exec(a.detail || "")?.[1]?.trim() || "Votre élu";
const elusDe = (a: Alerte) => a.senator_id || a.deputy_id || a.mep_id || nomDe(a);

/** Rend les alertes de vote d'un membre en blocs par texte. `nbTextes` sert au sujet de l'e-mail. */
export async function votesRegroupes(alertes: Alerte[], { maxTextes = 4, maxDetail = 7, expliquer = true }: { maxTextes?: number; maxDetail?: number; expliquer?: boolean } = {}):
  Promise<{ html: string; nbTextes: number; nbVotes: number; texte: string | null }> {
  const ids = (c: Chambre) => [...new Set(alertes.filter(a => chambreDe(a) === c && a.scrutin_id).map(a => String(a.scrutin_id)))];
  const [sen, an] = await Promise.all([
    parTranches(ids("SENAT"), async lot => (await supabase.from("legislative_scrutins").select("id, official_id, title, result_label, for_count, against_count, abstain_count, voted_at, source_url, dossier_id").in("official_id", lot)).data || []),
    parTranches(ids("AN"), async lot => (await supabase.from("scrutins").select("id, objet, title, resultat, pour, contre, abstention, date_scrutin").in("id", lot)).data || []),
  ]);
  // Le dossier législatif de chaque vote de l'Assemblée (fiche du texte sur le site) : le scrutin
  // rattaché par la synchronisation, à défaut le rapprochement de la navette (scrutin_navette).
  const dossierAn = new Map<string, string>();
  const [lsAn, navAn] = await Promise.all([
    parTranches(ids("AN"), async lot => (await supabase.from("legislative_scrutins").select("official_id, dossier_id").in("official_id", lot).not("dossier_id", "is", null)).data || []),
    parTranches(ids("AN"), async lot => (await supabase.from("scrutin_navette").select("scrutin_id, dossier_id").in("scrutin_id", lot).not("dossier_id", "is", null)).data || []),
  ]);
  for (const x of navAn as any[]) dossierAn.set(String(x.scrutin_id), String(x.dossier_id));
  for (const x of lsAn as any[]) dossierAn.set(String(x.official_id), String(x.dossier_id));
  const champsAmdt = "numero, texte_uid, texte_titre, division, expose, auteur, groupe, url, scrutin_id";
  const [amSen, amAn] = await Promise.all([
    parTranches(sen.map((s: any) => s.id), async lot => (await supabase.from("amendements_senat").select(champsAmdt).in("scrutin_id", lot)).data || []),
    parTranches(an.map((s: any) => s.id), async lot => (await supabase.from("amendements_an").select(champsAmdt).in("scrutin_id", lot)).data || []),
  ]) as [Amdt[], Amdt[]];
  const amdts = new Map<string, Amdt[]>();
  for (const a of [...amSen, ...amAn]) amdts.set(a.scrutin_id, [...(amdts.get(a.scrutin_id) || []), a]);
  const senParOfficiel = new Map(sen.map((s: any) => [s.official_id, s]));
  const anParId = new Map(an.map((s: any) => [s.id, s]));

  // Liens vers les fiches des élus (« voir tous ses votes »).
  const [fs, fd, fm] = await Promise.all([
    ["senators", "senator_id"], ["deputies", "deputy_id"], ["meps", "mep_id"],
  ].map(async ([table, champ]) => {
    const l = [...new Set(alertes.map(a => (a as any)[champ]).filter(Boolean))];
    return l.length ? ((await supabase.from(table).select("id, slug").in("id", l)).data || []) : [];
  }));
  const fiche = new Map<string, string>([
    ...fs.map((x: any) => [x.id, `${SITE_URL}/senateurs/${x.slug}`] as [string, string]),
    ...fd.map((x: any) => [x.id, `${SITE_URL}/deputes/${x.slug}`] as [string, string]),
    ...fm.map((x: any) => [x.id, `${SITE_URL}/eurodeputes/${x.slug}`] as [string, string]),
  ]);

  // Un vote = un scrutin, quel que soit le nombre d'élus suivis qui y ont pris part.
  const votes = new Map<string, Vote>();
  const noms = new Map<string, string>();
  for (const a of alertes) {
    const chambre = chambreDe(a);
    const cle = `${chambre}|${a.scrutin_id || a.title}`;
    noms.set(elusDe(a), nomDe(a));
    let v = votes.get(cle);
    if (!v) {
      const s: any = chambre === "SENAT" ? senParOfficiel.get(String(a.scrutin_id)) : chambre === "AN" ? anParId.get(String(a.scrutin_id)) : null;
      const titre = propre(s?.title || s?.objet || a.title || "");
      const am = s ? amdts.get(s.id) || [] : [];
      const pour = s?.for_count ?? s?.pour ?? null, contre = s?.against_count ?? s?.contre ?? null;
      const label = String(s?.result_label ?? s?.resultat ?? "");
      const adopte = /n['’]a pas adopt|rejet/i.test(label) ? false : /adopt/i.test(label) ? true : pour != null && contre != null ? pour > contre : null;
      const nature = chambre === "PE" ? "autre" : natureDe(titre);
      v = {
        cle, chambre, titre, date: s?.voted_at || s?.date_scrutin || a.event_at || null, source: s?.source_url || (chambre === "AN" && a.scrutin_id ? `https://www.assemblee-nationale.fr/dyn/17/scrutins/${String(a.scrutin_id).replace(/^VTANR5L17V/, "")}` : a.url || null),
        resultat: s ? { adopte, pour, contre, abstention: s?.abstain_count ?? s?.abstention ?? null } : null,
        amendements: am, elus: new Map(), nature, article: articleVise(titre, am[0]),
        texte: chambre === "PE" ? "Parlement européen" : texteDuScrutin(titre) || (am[0]?.texte_titre ? propre(am[0].texte_titre) : "Autres votes"),
        dossier: s?.dossier_id || (chambre === "AN" && a.scrutin_id ? dossierAn.get(String(a.scrutin_id)) || null : null),
      };
      votes.set(cle, v);
    }
    if (a.position) v.elus.set(elusDe(a), String(a.position).toUpperCase());
  }

  // Par texte (et par chambre : la navette fait voter deux fois le même texte).
  const groupes = new Map<string, Vote[]>();
  for (const v of votes.values()) {
    const k = `${v.chambre}|${v.texte.toLowerCase().replace(/[’']/g, "'")}`;
    groupes.set(k, [...(groupes.get(k) || []), v]);
  }
  const RANG: Record<Nature, number> = { ensemble: 0, motion: 1, partie: 2, article: 3, amendement: 4, autre: 5 };
  const rang = (v: Vote) => RANG[v.nature] * 10 + (v.nature === "amendement" && v.resultat?.adopte ? 0 : v.nature === "amendement" ? 1 : 0);
  const ordre = [...groupes.values()].sort((a, b) => b.length - a.length || Math.min(...a.map(rang)) - Math.min(...b.map(rang)));

  const affiches = ordre.slice(0, maxTextes);
  // Votes détaillés : un par texte au moins, le reste aux textes les plus votés (cinq au plus pour un même texte).
  const quota = new Map(affiches.map(g => [g, 1]));
  for (let reste = maxDetail - affiches.length; reste > 0; reste--) {
    const g = affiches.filter(x => quota.get(x)! < Math.min(x.length, 5)).sort((a, b) => b.length / quota.get(b)! - a.length / quota.get(a)!)[0];
    if (!g) break;
    quota.set(g, quota.get(g)! + 1);
  }
  let html = "";
  for (const g of affiches) {
    const v0 = g[0];
    g.sort((a, b) => rang(a) - rang(b) || String(b.date).localeCompare(String(a.date)));
    const detail = g.slice(0, quota.get(g));
    const jours = [...new Set(g.map(v => v.date?.slice(0, 10)).filter(Boolean))].sort() as string[];
    const fmt = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });
    const quand = jours.length ? (jours.length === 1 ? fmt(jours[0]) : `du ${fmt(jours[0])} au ${fmt(jours[jours.length - 1])}`) : "";

    // Texte en discussion (pour lire les articles) : un amendement de ce texte, à défaut un du même dossier.
    let amdtTexte = g.flatMap(v => v.amendements).find(a => a.texte_uid || a.url) || null;
    if (!amdtTexte && expliquer && v0.chambre === "SENAT" && v0.dossier && g.some(v => v.article)) {
      const { data: ls } = await supabase.from("legislative_scrutins").select("id").eq("dossier_id", v0.dossier).order("voted_at", { ascending: false }).limit(200);
      if (ls?.length) amdtTexte = ((await supabase.from("amendements_senat").select(champsAmdt).in("scrutin_id", ls.map(x => x.id)).limit(1)).data || [])[0] || null;
    }
    if (!amdtTexte && expliquer && v0.chambre === "AN" && g.some(v => v.article)) {
      const motif = v0.texte.replace(/^(projet|proposition) de loi( organique)?\s*/i, "").replace(/['’]/g, "_").slice(0, 60);
      if (motif.length > 8) amdtTexte = ((await supabase.from("amendements_an").select(champsAmdt).ilike("texte_titre", `%${motif}%`).order("vu_le", { ascending: false }).limit(1)).data || [])[0] || null;
    }

    // Bilan de chaque élu suivi sur ce texte.
    const bilan = new Map<string, Record<string, number>>();
    for (const v of g) for (const [e, p] of v.elus) { const b = bilan.get(e) || {}; b[p] = (b[p] || 0) + 1; bilan.set(e, b); }
    const lignesBilan = [...bilan.entries()].map(([e, b]) => {
      const total = Object.values(b).reduce((x, y) => x + y, 0);
      const parts = ["POUR", "CONTRE", "ABSTENTION"].filter(p => b[p]).map(p => `<strong style="color:${COULEUR_POS[p]}">${b[p]} ${MOT_POS[p]}</strong>`);
      const nom = fiche.has(e) ? `<a href="${esc(fiche.get(e))}" style="color:${COULEURS.encre};font-weight:700;text-decoration:none">${esc(noms.get(e))}</a>` : `<strong>${esc(noms.get(e))}</strong>`;
      return total === 1 ? null : `${nom} : ${total} votes (${parts.join(", ")})`;
    }).filter(Boolean);

    const cartes: string[] = [];
    for (const v of detail) {
      const but = v.nature === "amendement" ? butAmendement(v.amendements.find(a => a.expose)?.expose) : null;
      const sens = sensProcedure(v);
      const art = expliquer && v.article && v.chambre !== "PE" && amdtTexte ? await expliquerArticle(v.chambre, v.texte, amdtTexte, v.article).catch(() => null) : null;
      const res = v.resultat && v.resultat.adopte != null
        ? `<strong style="color:${v.resultat.adopte ? "#059669" : "#e11d48"}">${v.resultat.adopte ? "Adopté" : "Rejeté"}</strong>${v.resultat.pour != null ? ` (${v.resultat.pour} pour, ${v.resultat.contre} contre${v.resultat.abstention ? `, ${v.resultat.abstention} abst.` : ""})` : ""}` : "";
      const ou = cible(v);
      const titreVote = v.source ? `<a href="${esc(v.source)}" style="color:${COULEURS.encre};text-decoration:none">${esc(libelle(v))}</a>` : esc(libelle(v));
      cartes.push(`<div style="margin-top:10px;padding:12px 14px;border-radius:12px;background:#f8fafc;border:1px solid #eef2f7">
        <div style="font-size:14px;line-height:1.4;font-weight:700;color:${COULEURS.encre}">${titreVote}</div>
        ${ou || res ? `<div style="font-size:12px;color:#64748b;margin-top:3px">${[ou ? esc(ou) : "", res].filter(Boolean).join(" · ")}</div>` : ""}
        ${sens ? `<div style="font-size:13px;line-height:1.55;color:#334155;margin-top:8px">${esc(sens)}</div>` : ""}
        ${but ? `<div style="font-size:13px;line-height:1.55;color:#334155;margin-top:8px"><span style="font-weight:700;color:#4f46e5">${but.direct ? "Ce que proposait l'amendement" : "Ce qu'en disent ses auteurs"} :</span> « ${esc(but.texte)} »</div>` : ""}
        ${art ? `<div style="font-size:13px;line-height:1.55;color:#334155;margin-top:8px"><span style="font-weight:700;color:#0f766e">Ce que prévoit l'article ${esc(v.article)} :</span> ${esc(art.texte)} <a href="${esc(art.url)}" style="color:#94a3b8;font-size:11px">texte officiel</a></div>` : ""}
        <div style="font-size:13px;line-height:1.6;color:#334155;margin-top:8px">${[...v.elus.entries()].map(([e, p]) =>
          `${esc(noms.get(e))} <strong style="color:${COULEUR_POS[p] || "#64748b"}">${MOT_POS[p] || esc(p.toLowerCase())}</strong>`).join(" · ")}</div>
      </div>`);
    }
    const reste = g.length - detail.length;
    // La fiche du texte sur le site (résumé, parcours, tous les votes) : le dossier d'un des votes du groupe.
    const dossierTexte = g.find(v => v.dossier)?.dossier || (v0.chambre !== "PE" ? await dossierParTitre(v0.texte) : null);
    const lienTexte = dossierTexte ? `${SITE_URL}/lois/?dossier=${encodeURIComponent(dossierTexte)}` : null;
    const liens = [...bilan.keys()].filter(e => fiche.has(e)).map(e => `<a href="${esc(fiche.get(e))}" style="color:#4f46e5">${esc(noms.get(e))}</a>`);
    html += `<div style="padding:16px 0;border-bottom:1px solid ${COULEURS.filet}">
      <div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#4f46e5">${esc(CHAMBRE[v0.chambre])}${quand ? ` · ${esc(quand)}` : ""} · ${g.length} vote${g.length > 1 ? "s" : ""}</div>
      <div style="font-size:16px;line-height:1.35;font-weight:800;color:${COULEURS.encre};margin-top:4px">${lienTexte ? `<a href="${esc(lienTexte)}" style="color:${COULEURS.encre};text-decoration:none">${esc(majuscule(v0.texte))}</a>` : esc(majuscule(v0.texte))}</div>
      ${lienTexte ? `<div style="margin-top:8px"><a href="${esc(lienTexte)}" style="display:inline-block;padding:7px 12px;border-radius:10px;background:#eef2ff;color:#4338ca;font-size:12px;font-weight:800;text-decoration:none">Voir le texte sur La Politique c'est Simple →</a></div>` : ""}
      ${lignesBilan.length ? `<div style="font-size:13px;line-height:1.6;color:#334155;margin-top:6px">${lignesBilan.join("<br>")}</div>` : ""}
      ${cartes.join("")}
      ${reste > 0 ? `<div style="font-size:12px;color:#64748b;margin-top:10px">+ ${reste} autre${reste > 1 ? "s" : ""} vote${reste > 1 ? "s" : ""} sur ce texte${liens.length ? ` — tout voir sur la fiche de ${liens.join(", de ")}` : ""}.</div>` : ""}
    </div>`;
  }
  const masques = ordre.length - affiches.length;
  if (masques > 0) html += `<div style="font-size:12px;color:#64748b;padding:10px 0">Et des votes sur ${masques} autre${masques > 1 ? "s" : ""} texte${masques > 1 ? "s" : ""} : à retrouver dans <a href="${SITE_URL}/dashboard" style="color:#4f46e5">vos alertes</a>.</div>`;
  return { html, nbTextes: ordre.length, nbVotes: votes.size, texte: ordre[0]?.[0]?.texte ?? null };
}
