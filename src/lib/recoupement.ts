import { sansAccent } from "./cycles.js";

/**
 * Recoupement d'une information de presse : qui d'autre la donne ?
 *
 * C'est le garde-fou des fils nourris par la presse. On ne peut pas y relire l'article (lien
 * de redirection, mur de consentement), mais on peut vérifier qu'un fait n'est pas porté par
 * un seul journal : on cherche, sur sept jours, les médias DISTINCTS dont le titre partage au
 * moins deux mots distinctifs, et un tiers des mots, avec le titre d'origine.
 *
 * Une information « unique » n'est pas fausse : elle n'est pas recoupée. Elle reste publiée,
 * avec la mention « un seul média » — décision de l'éditeur du 12 octobre 2026 : retenir ces
 * informations priverait les petites communes de presque toute leur actualité.
 */

const UA = { "User-Agent": "Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)" };

const BANALS = new Set(["apres", "avant", "contre", "entre", "depuis", "pendant", "cette", "leurs", "notre", "votre", "toute", "toutes", "selon",
  "ainsi", "alors", "aussi", "encore", "faire", "avoir", "etre", "commune", "communes", "departement", "region", "france", "francais", "politique"]);

/** Source institutionnelle : son information n'a pas à être recoupée par la presse. */
export const OFFICIEL = /\.gouv\.fr|legifrance|journal-officiel|senat\.fr|assemblee-nationale\.fr|elysee\.fr|prefecture|\bpr[ée]fet\b|conseil (d[ée]partemental|r[ée]gional)|\bmairie\b|\bville de\b|m[ée]tropole/i;

const distinctifs = (titre: string) => [...new Set(sansAccent(titre).split(/[^a-z0-9]+/).filter(m => m.length >= 5 && !BANALS.has(m)))];

/** Titre et média d'un intitulé Google Actualités (« Titre de l'article - Ouest-France »). */
export function titreEtMedia(intitule: string): { titre: string; media: string } {
  const i = intitule.lastIndexOf(" - ");
  return i > 0 ? { titre: intitule.slice(0, i).trim(), media: intitule.slice(i + 3).trim() } : { titre: intitule.trim(), media: "" };
}

export async function recouper(titre: string, media: string | null): Promise<{ etat: "recoupe" | "unique"; medias: string[] } | null> {
  const mots = distinctifs(titre);
  // Trop peu de mots distinctifs : la recherche ramènerait n'importe quoi, on ne conclut pas.
  if (mots.length < 3) return null;
  // Les mots les plus longs sont les plus discriminants (noms propres, termes techniques).
  // Quatre mots seulement : deux journaux ne titrent jamais pareil, et une requête trop
  // précise ne ramène que l'article d'origine.
  const requete = [...mots].sort((a, b) => b.length - a.length).slice(0, 4).join(" ");
  const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(requete + " when:7d")}&hl=fr&gl=FR&ceid=FR:fr`,
    { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Google Actualités : HTTP ${r.status}`);
  const xml = await r.text();
  const balise = (bloc: string, n: string) =>
    (bloc.match(new RegExp("<" + n + "[^>]*>([^]*?)</" + n + ">"))?.[1] ?? "").replace("<![CDATA[", "").replace("]]>", "").trim();
  const origine = sansAccent(media || "");
  const autres = new Map<string, string>();
  for (const it of xml.split("<item>").slice(1)) {
    const nom = balise(it, "source");
    const cle = sansAccent(nom);
    if (!cle || (origine && (cle.includes(origine) || origine.includes(cle)))) continue;
    const communs = distinctifs(titreEtMedia(balise(it, "title")).titre).filter(m => mots.includes(m)).length;
    // Même fait : au moins deux mots distinctifs en commun, et un tiers du titre. Le seuil est
    // volontairement accueillant : dire à tort « un seul média » d'une information que deux
    // journaux donnent serait une erreur affichée ; manquer une mention n'en est pas une.
    if (communs >= 2 && communs / mots.length >= 0.34) autres.set(cle, nom);
  }
  const medias = [...autres.values()].slice(0, 8);
  return { etat: medias.length ? "recoupe" : "unique", medias };
}
