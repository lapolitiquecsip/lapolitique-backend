import { sansAccent } from "./cycles.js";
import { chiffresAbsents } from "./verification-source.js";

/**
 * BANC D'ESSAI MULTI-AGENTS — du 12 au 18 octobre 2026.
 *
 * But : savoir, fonctionnalité par fonctionnalité, ce qu'apporterait une chaîne d'agents
 * (un qui écrit, un qui vérifie, un qui relit avec un autre modèle, un qui contrôle), AVANT
 * de toucher à quoi que ce soit. Pendant l'essai, les contenus du site sont produits comme
 * d'habitude ; les agents du banc passent derrière et notent ce qu'ils auraient retenu,
 * corrigé ou refusé. Rien de ce qu'ils écrivent n'est lu par le site.
 *
 * Une « famille » est une fonctionnalité dont la sortie est un texte rédigé par une IA à
 * partir d'une source que l'on peut relire. Les fonctionnalités dont la source n'est pas
 * accessible à une machine (Légifrance, fermé par Cloudflare ; vidéos sans transcription
 * conservée) ne sont pas dans le banc : on ne peut pas y vérifier un texte contre sa source.
 */

export type Famille = {
  /** Identifiant court ; le cycle du journal est « banc:<cle> ». */
  cle: string;
  nom: string;
  table: string;
  id: string;
  /** Colonne de date de production, pour prendre les plus récents. */
  date: string;
  colonnes: string;
  /** Ne garder que les lignes réellement rédigées. */
  filtre?: (q: any) => any;
  /** Le texte publié, tel que le lecteur le voit. */
  texte: (r: any) => string;
  /** La source : du texte déjà en base, sinon une adresse à relire. */
  source: (r: any) => { texte?: string; url?: string };
  titre: (r: any) => string;
  sujet?: (r: any) => string | null;
  /** Au-delà de ce nombre d'heures sans nouvelle production, la sentinelle le signale. */
  fraicheur: number;
};

/** Toutes les chaînes d'une valeur JSON, à plat. */
export function chaines(v: any): string[] {
  if (v == null) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(chaines);
  if (typeof v === "object") return Object.values(v).flatMap(chaines);
  return [];
}

const premiereUrl = (v: any): string | undefined => chaines(v).find(s => /^https?:\/\//.test(s));

export const FAMILLES: Famille[] = [
  {
    cle: "commissions", nom: "Analyses des commissions (Pro)", table: "commission_reports", id: "ref", date: "analyzed_at",
    colonnes: "ref, chamber, commission, title, cr_url, summary, analysis, analyzed_at",
    filtre: q => q.not("analyzed_at", "is", null),
    texte: r => [r.summary, ...chaines(r.analysis).filter(s => s !== "transcription")].filter(Boolean).join("\n"),
    source: r => ({ url: r.cr_url }), titre: r => r.title ?? r.ref, sujet: r => r.commission, fraicheur: 96,
  },
  {
    // `created_at` et non `date_traitement` : ce dernier n'est rempli que par l'une des deux
    // chaînes qui alimentent le fil, et la sentinelle le croyait arrêté quand l'autre publiait.
    cle: "fil-accueil", nom: "Fil d'actualité de l'accueil", table: "content", id: "id", date: "created_at",
    colonnes: "id, titre_original, titre_simplifie, resume_flash, resume_detaille, raw_text, source_url, source_name, date_publication, created_at",
    filtre: q => q.not("resume_flash", "is", null),
    texte: r => [r.titre_simplifie, r.resume_flash, r.resume_detaille].filter(Boolean).join("\n"),
    // Le média et la date font partie de la source : le résumé les cite, à juste titre.
    source: r => (String(r.raw_text ?? "").length > 500
      ? { texte: `Média : ${r.source_name ?? "?"} — publié le ${String(r.date_publication ?? "").slice(0, 10)}\n${r.titre_original}\n${r.raw_text}` }
      : { url: r.source_url }),
    titre: r => r.titre_simplifie ?? r.titre_original, sujet: r => r.source_name, fraicheur: 30,
  },
  {
    cle: "fils-entites", nom: "Fils des ministères, collectivités, communes et partis", table: "entity_feed", id: "id", date: "created_at",
    colonnes: "id, entity_type, source_name, url, title, summary, created_at",
    filtre: q => q.not("summary", "is", null),
    texte: r => [r.title, r.summary].filter(Boolean).join("\n"),
    source: r => ({ url: r.url }), titre: r => r.title, sujet: r => r.entity_type, fraicheur: 30,
  },
  {
    cle: "actus-candidats", nom: "Actualités des candidats", table: "candidate_news", id: "id", date: "created_at",
    colonnes: "id, title, summary, source_name, source_url, created_at",
    filtre: q => q.not("summary", "is", null),
    texte: r => [r.title, r.summary].filter(Boolean).join("\n"),
    source: r => ({ url: r.source_url }), titre: r => r.title, sujet: r => r.source_name, fraicheur: 48,
  },
  {
    cle: "elysee", nom: "Résumés des publications de l'Élysée", table: "elysee_publications", id: "id", date: "updated_at",
    colonnes: "id, type, title, url, summary, updated_at",
    filtre: q => q.not("summary", "is", null),
    texte: r => r.summary ?? "", source: r => ({ url: r.url }), titre: r => r.title, sujet: r => r.type, fraicheur: 168,
  },
  {
    cle: "alertes-pro", nom: "« Ce texte vous concerne » (Pro)", table: "textes_impacts", id: "id", date: "analyse_le",
    colonnes: "id, source, titre, resume, extrait, url, explication, analyse_le",
    filtre: q => q.not("explication", "is", null),
    texte: r => r.explication ?? "",
    source: r => ({ texte: [r.titre, r.resume, r.extrait].filter(Boolean).join("\n") }),
    titre: r => r.titre, sujet: r => r.source, fraicheur: 96,
  },
  {
    cle: "controverses", nom: "Veille des controverses", table: "controverses_veille", id: "id", date: "maj_le",
    colonnes: "id, personne, texte, sources, masquee, maj_le",
    filtre: q => q.eq("masquee", false),
    texte: r => r.texte ?? "", source: r => ({ url: premiereUrl(r.sources) }), titre: r => r.personne, sujet: r => r.personne, fraicheur: 168,
  },
  // Hors banc pour l'instant, faute de source relisible :
  //  - résumés des lois et analyses des dossiers : la base ne garde que l'adresse de la page
  //    du dossier, pas celle du texte dont le résumé est tiré ;
  //  - décrets et Journal officiel : Légifrance refuse les lectures automatiques ;
  //  - résumés des vidéos et débats : la transcription n'est pas conservée ;
  //  - explications des scrutins : écrites à partir du seul intitulé du vote.
];

/* ───────────────────────────── Lire une source ───────────────────────────── */

const UA = { "User-Agent": "Mozilla/5.0 (compatible; LaPolitiqueBot/1.0; +https://lapolitiquecestsimple.fr)" };

export function htmlVersTexte(html: string): string {
  return html
    .replace(/<(script|style|nav|footer|header|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&apos;/g, "'")
    .replace(/&eacute;/g, "é").replace(/&egrave;/g, "è").replace(/&agrave;/g, "à").replace(/&ccedil;/g, "ç")
    .replace(/\s+/g, " ").trim();
}

/** Le texte de la source, ou le motif pour lequel on ne peut pas la relire. */
export async function lireSource(s: { texte?: string; url?: string }): Promise<{ texte: string } | { motif: string }> {
  if (s.texte && s.texte.length > 200) return { texte: s.texte.slice(0, 300000) };
  if (!s.url) return { motif: "aucune source enregistrée" };
  if (/news\.google\.|legifrance\.gouv\.fr/.test(s.url)) return { motif: "source non lisible par une machine (redirection ou accès fermé)" };
  try {
    const r = await fetch(s.url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(25000) });
    if (!r.ok) return { motif: `la source répond HTTP ${r.status}` };
    if (!/html|text|xml/.test(r.headers.get("content-type") || "html")) return { motif: "source dans un format non lu (PDF, image)" };
    const texte = htmlVersTexte(await r.text());
    return texte.length > 600 ? { texte: texte.slice(0, 300000) } : { motif: "source vide ou réservée aux abonnés" };
  } catch (e: any) {
    return { motif: `source injoignable (${String(e?.message ?? e).slice(0, 60)})` };
  }
}

/* ───────────────────────── Le contrôle sans IA ───────────────────────── */

const NOM_PROPRE = /\b[A-ZÉÈÀÂÎÔÛÇ][a-zà-ÿ'’]+(?:[ -](?:de |du |des |d'|la |le )?[A-ZÉÈÀÂÎÔÛÇ][a-zà-ÿ'’]+)+/g;

/**
 * Ce que le texte publié affirme et que sa source ne porte pas.
 *
 * Deux signaux, choisis parce qu'ils ne demandent aucune interprétation :
 *  - un NOMBRE absent de la source — le signe le plus sûr d'un chiffre inventé ou recalculé ;
 *  - un NOM PROPRE absent de la source — une personne ou un organisme que le rédacteur a
 *    ajouté de lui-même.
 * Les années et les chiffres isolés sont ignorés : un résumé date souvent les faits, et
 * « trois » s'écrit en lettres dans la source.
 */
export function controler(texte: string, source: string): { chiffres: string[]; noms: string[] } {
  const src = sansAccent(source);
  // Nombres : lecture commune aux deux dépôts (nombres en lettres de la source, dates et
  // heures ignorées).
  const chiffres = new Set<string>(chiffresAbsents(texte, source));
  const noms = new Set<string>();
  for (const n of texte.match(NOM_PROPRE) ?? []) {
    const mots = sansAccent(n).split(/[ -]/).filter(m => m.length > 3);
    // Un nom est porté par la source si son dernier mot y figure : « Bruno Retailleau »
    // peut y être « M. Retailleau ».
    if (mots.length && !src.includes(mots[mots.length - 1])) noms.add(n);
  }
  return { chiffres: [...chiffres].slice(0, 12), noms: [...noms].slice(0, 12) };
}

/**
 * Les passages de la source qui portent le texte publié.
 *
 * Un compte rendu d'audition fait cent mille caractères ; le relecteur n'en lit que
 * quelques milliers. Lui donner le début du document, c'est lui faire dire « absent de la
 * source » pour tout ce qui est dit plus loin. On lui donne donc les passages où se trouvent
 * les nombres et les mots rares du texte publié, dans l'ordre du document.
 */
export function extraitPertinent(source: string, texte: string, max: number): { extrait: string; partiel: boolean } {
  if (source.length <= max) return { extrait: source, partiel: false };
  const reperes = new Set<string>();
  for (const n of texte.match(/\d+(?:[.,]\d+)?/g) ?? []) if (n.length >= 2) reperes.add(n);
  for (const m of sansAccent(texte).match(/[a-z]{7,}/g) ?? []) reperes.add(m);
  const TAILLE = 1200;
  const src = sansAccent(source);
  const fenetres: { debut: number; score: number }[] = [];
  for (let i = 0; i < source.length; i += TAILLE) {
    const bloc = src.slice(i, i + TAILLE);
    let score = 0;
    for (const r of reperes) if (bloc.includes(r)) score += /\d/.test(r) ? 3 : 1;
    fenetres.push({ debut: i, score });
  }
  const gardees = [...fenetres].sort((a, b) => b.score - a.score).slice(0, Math.floor(max / TAILLE))
    .sort((a, b) => a.debut - b.debut);
  return { extrait: gardees.map(f => source.slice(f.debut, f.debut + TAILLE)).join("\n[…]\n"), partiel: true };
}
