import { supabase } from "../config/supabase.js";

/**
 * Envoi des e-mails aux membres (Resend) et habillage commun.
 *
 * Variables : RESEND_API_KEY (sans elle : simulation, rien ne part), EMAIL_FROM
 * (expéditeur vérifié sur lapolitiquecestsimple.fr), SITE_URL.
 */
export const SITE_URL = process.env.SITE_URL || "https://lapolitiquecestsimple.fr";
const FROM = process.env.EMAIL_FROM || "La Politique C'est Simple <onboarding@resend.dev>";
const RESEND_KEY = process.env.RESEND_API_KEY;
export const simulation = !RESEND_KEY;

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export async function envoyerMail(to: string, sujet: string, html: string, opts: { desabo?: string; texte?: string } = {}): Promise<boolean> {
  if (!RESEND_KEY) { console.log(`[SIMULATION] → ${to} : ${sujet}`); return true; }
  const headers: Record<string, string> = {};
  // Désabonnement en un clic reconnu par Gmail et Outlook (RFC 8058).
  if (opts.desabo) { headers["List-Unsubscribe"] = `<${opts.desabo}>`; headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"; }
  for (let essai = 1; essai <= 3; essai++) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject: sujet, html, ...(opts.texte ? { text: opts.texte } : {}), ...(Object.keys(headers).length ? { headers } : {}) }),
      signal: AbortSignal.timeout(20000),
    }).catch(() => null);
    if (r?.ok) return true;
    // 429 : limite de débit de Resend (2 envois/s en offre gratuite) → on patiente.
    if (r && r.status !== 429 && r.status < 500) { console.error(`[MAIL] échec ${to} : HTTP ${r.status} ${(await r.text()).slice(0, 200)}`); return false; }
    await new Promise(res => setTimeout(res, 1500 * essai));
  }
  console.error(`[MAIL] échec ${to} après 3 essais`);
  return false;
}

/** Adresse de connexion de chaque membre (annuaire d'authentification). */
export async function adressesDesMembres(ids: string[]): Promise<Map<string, string>> {
  const voulus = new Set(ids); const out = new Map<string, string>();
  for (let page = 1; page <= 20 && out.size < voulus.size; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (voulus.has(u.id) && u.email) out.set(u.id, u.email);
    if (data.users.length < 1000) break;
  }
  return out;
}

/* ─────────────────────────── Habillage ─────────────────────────── */

export const COULEURS = { fond: "#f4f1ea", carte: "#ffffff", encre: "#0f172a", doux: "#475569", pale: "#94a3b8", filet: "#e7e2d6", nuit: "#0b1020" };
const POLICE = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const TITRE = "'Staatliches','Bebas Neue',Impact,'Arial Narrow Bold','Helvetica Neue',sans-serif";

/** Gabarit d'e-mail : en-tête sombre, corps clair, pied avec réglages et désabonnement. */
export function gabarit({ preheader, surtitre, titre, sousTitre, corps, pied }: {
  preheader: string; surtitre: string; titre: string; sousTitre: string; corps: string; pied: string;
}): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">
<link href="https://fonts.googleapis.com/css2?family=Staatliches&display=swap" rel="stylesheet">
<title>${esc(titre)}</title></head>
<body style="margin:0;padding:0;background:${COULEURS.fond};font-family:${POLICE};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COULEURS.fond}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
  <tr><td style="background:${COULEURS.nuit};border-radius:24px 24px 0 0;padding:30px 32px 26px">
    <table role="presentation" width="100%"><tr>
      <td style="font-family:${TITRE};font-size:17px;letter-spacing:.04em;color:#ffffff;text-transform:uppercase">La politique, c'est <span style="background:#10b981;color:#ffffff;padding:1px 6px;border-radius:4px">simple.</span></td>
      <td align="right" style="font-size:11px;font-weight:700;letter-spacing:.14em;color:#c4b5fd;text-transform:uppercase">${esc(surtitre)}</td>
    </tr></table>
    <div style="font-family:${TITRE};font-size:40px;line-height:1;color:#ffffff;text-transform:uppercase;margin-top:22px">${titre}</div>
    <div style="font-size:14px;line-height:1.5;color:#cbd5e1;margin-top:10px">${sousTitre}</div>
  </td></tr>
  <tr><td style="background:${COULEURS.carte};padding:8px 32px 28px;border-radius:0 0 24px 24px">${corps}</td></tr>
  <tr><td style="padding:22px 20px 8px;text-align:center;font-size:11px;line-height:1.6;color:${COULEURS.pale}">${pied}<br><span style="font-size:10px">Résumés et explications rédigés par intelligence artificielle à partir des textes officiels et contrôlés contre eux ; seul le texte officiel fait foi.</span></td></tr>
</table></td></tr></table></body></html>`;
}

/** Titre de rubrique : pastille de couleur, intitulé en capitales, compteur. */
export function rubrique(emoji: string, intitule: string, couleur: string, contenu: string, note?: string): string {
  return `<div style="margin-top:30px">
  <table role="presentation" width="100%"><tr>
    <td style="width:36px;vertical-align:middle"><div style="width:30px;height:30px;line-height:30px;text-align:center;border-radius:10px;background:${couleur}1a;font-size:16px">${emoji}</div></td>
    <td style="vertical-align:middle;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${COULEURS.encre}">${esc(intitule)}</td>
  </tr></table>
  <div style="height:3px;width:44px;background:${couleur};border-radius:3px;margin:8px 0 6px"></div>
  ${note ? `<div style="font-size:12px;color:${COULEURS.pale};margin-bottom:4px">${note}</div>` : ""}
  ${contenu}
</div>`;
}

/** Une ligne d'information : étiquette facultative, titre (lien), résumé court. */
export function ligne({ titre, url, resume, etiquette, couleur = "#6366f1", meta, retour, libelleRetour = "Pas intéressant" }: {
  titre: string; url?: string | null; resume?: string | null; etiquette?: string | null; couleur?: string; meta?: string | null;
  /** Lien « Pas intéressant » (un clic, sans connexion) : le récap en tient compte ensuite. */
  retour?: string | null; libelleRetour?: string;
}): string {
  if (retour) meta = `${meta ? `${meta} · ` : ""}<a href="${esc(retour)}" style="color:${COULEURS.pale};text-decoration:underline">${esc(libelleRetour)}</a>`;
  const t = url ? `<a href="${esc(url)}" style="color:${COULEURS.encre};text-decoration:none">${esc(titre)}</a>` : esc(titre);
  return `<div style="padding:13px 0;border-bottom:1px solid ${COULEURS.filet}">
  ${etiquette ? `<div style="font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${couleur};margin-bottom:4px">${esc(etiquette)}</div>` : ""}
  <div style="font-size:15px;line-height:1.4;font-weight:700;color:${COULEURS.encre}">${t}</div>
  ${resume ? `<div style="font-size:13px;line-height:1.55;color:${COULEURS.doux};margin-top:4px">${esc(resume)}</div>` : ""}
  ${meta ? `<div style="font-size:11px;color:${COULEURS.pale};margin-top:5px">${meta}</div>` : ""}
</div>`;
}

export function bouton(texte: string, url: string, couleur = COULEURS.nuit): string {
  return `<table role="presentation" style="margin-top:22px"><tr><td style="border-radius:14px;background:${couleur}">
  <a href="${esc(url)}" style="display:inline-block;padding:13px 22px;font-size:13px;font-weight:800;letter-spacing:.06em;color:#ffffff;text-decoration:none;text-transform:uppercase">${esc(texte)} →</a>
</td></tr></table>`;
}

/**
 * Un même fait ne paraît qu'une fois dans un e-mail, quelle que soit la rubrique ou l'entité
 * suivie qui l'amène (un article sur Jean-Luc Mélenchon qui nomme LFI arrive par le candidat
 * ET par le parti). Doublon : même titre, même article (lien externe), ou titres presque
 * identiques (8 mots significatifs sur 10 en commun, mêmes chiffres, mêmes noms propres :
 * « Le Sénat adopte X » et « L'Assemblée adopte X » restent deux faits).
 * Les liens du site ne comptent pas : une même page (/lois/?dossier=…, /partis/…/#votes) sert
 * plusieurs faits distincts. Les lignes de vote (un élu, un groupe) n'y passent pas non plus.
 * `fait` : le fait d'origine noté par le tri des suivis (lib/faits-suivis.ts) — deux titres
 * différents d'un même fait (« Bardella publie Gouverner » / « Publication du livre de Bardella »).
 * `nouveau(titre, url, fait)` répond false pour un doublon, et retient sinon la ligne.
 */
export function antiDoublon() {
  const plat = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’`]/g, "'");
  const site = SITE_URL.replace(/^https?:\/\/(www\.)?/i, "").toLowerCase();
  const lien = (u?: string | null) => {
    const l = String(u || "").trim().replace(/#.*$/, "").replace(/[?&]utm_[^&]*/g, "").replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/i, "").toLowerCase();
    return !l || l.startsWith(site) || !/^[a-z0-9.-]+\.[a-z]{2,}\//.test(l) ? "" : l;
  };
  const empreinte = (t: string) => ({
    titre: plat(t).replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90),
    mots: new Set(plat(t).split(/[^a-z0-9]+/).filter(m => m.length > 3)),
    chiffres: (plat(t).match(/\d+/g) || []).sort().join(","),
    noms: (String(t || "").match(/(?<=\s)[A-ZÉÈÀÂÎÔ][\wÀ-ÿ'-]{2,}/g) || []).map(plat).sort().join(","),
  });
  // Le fait se compare sur ce qu'il RACONTE, sans les noms propres (« David Lisnard propose de
  // geler les pensions » et « David Lisnard propose une baisse de la CSG » sont deux faits) :
  // mots en minuscules de 4 lettres et plus, réduits à leur radical, hors mots vides ;
  // 3 en commun au moins, et les trois quarts des mots du fait le plus court.
  const VIDES = new Set(["dans", "avec", "pour", "sous", "sans", "entre", "vers", "chez", "selon", "depuis", "leur", "leurs", "cette", "plus", "moins", "tout", "tous", "toute", "sont", "etre", "fait", "font", "nouveau", "nouvelle"]);
  const motsFait = (f?: string | null) => new Set(String(f || "").split(/[^\p{L}\p{N}]+/u)
    .filter(m => /^\p{Ll}/u.test(m)).map(plat).filter(m => m.length > 3 && !VIDES.has(m)).map(m => m.slice(0, 5)));
  const memeFait = (a: Set<string>, b: Set<string>) => {
    const communs = [...a].filter(m => b.has(m)).length;
    return communs >= 3 && communs / Math.min(a.size, b.size) >= 0.75;
  };
  const vus: (ReturnType<typeof empreinte> & { lien: string; fait: Set<string> })[] = [];
  return (titre: string, url?: string | null, fait?: string | null): boolean => {
    const e = { ...empreinte(titre), lien: lien(url), fait: motsFait(fait) };
    const doublon = vus.some(v => (e.titre && v.titre === e.titre) || (e.lien && v.lien === e.lien)
      || (e.fait.size && v.fait.size && memeFait(e.fait, v.fait))
      || (Math.min(e.mots.size, v.mots.size) >= 5 && e.chiffres === v.chiffres && e.noms === v.noms
        && [...e.mots].filter(m => v.mots.has(m)).length / Math.min(e.mots.size, v.mots.size) >= 0.8));
    if (!doublon) vus.push(e);
    return !doublon;
  };
}

export const resumeCourt = (s: string | null | undefined, max = 190) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, t.lastIndexOf(" ", max)) + "…";
};
