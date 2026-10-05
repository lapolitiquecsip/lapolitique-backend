/**
 * Fiche officielle d'un sénateur sur senat.fr.
 *
 * Plus à jour que l'open data ODSEN : après le renouvellement de septembre 2026,
 * les pages des sénateurs portaient leur groupe dès le début d'octobre quand
 * ODSEN affichait encore « Aucun ». Elles donnent aussi l'état civil, la
 * profession, les mandats locaux et toutes les fonctions antérieures : la matière
 * d'une biographie, y compris pour un élu qui n'a pas d'article Wikipédia.
 */

const BASE = "https://www.senat.fr";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; lapolitiquecestsimple-senat)" };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function lire(url: string): Promise<string | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
    } catch { /* nouvel essai */ }
    await sleep(1500 * (i + 1));
  }
  return null;
}

const ENTITES: Record<string, string> = { nbsp: " ", amp: "&", quot: '"', apos: "'", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", ccedil: "ç", ocirc: "ô", icirc: "î", ucirc: "û", rsquo: "’" };
const texte = (html: string) => html
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
  .replace(/<[^>]+>/g, "\n")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&([a-z]+);/gi, (m, e) => ENTITES[e.toLowerCase()] ?? m)
  .split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);

/** Annuaire des sénateurs en fonction : matricule (minuscules) → adresse de la fiche. */
export async function annuaireSenat(): Promise<Map<string, string>> {
  const html = await lire(`${BASE}/senateurs/senatl.html`);
  const out = new Map<string, string>();
  for (const m of (html || "").matchAll(/href="(\/senateur\/[a-z0-9_-]+?(\d{5}[a-z])\.html)"/gi)) out.set(m[2].toLowerCase(), BASE + m[1]);
  return out;
}

/** Codes de groupe utilisés dans la base (repris de l'open data du Sénat). */
const GROUPES: [RegExp, string][] = [
  [/^Les Républicains/i, "Les Républicains"],
  [/^Union Centriste/i, "UC"],
  [/^Socialiste, [ÉE]cologiste et R[ée]publicain/i, "SER"],
  [/^Communiste R[ée]publicain Citoyen/i, "CRCE-K"],
  [/^Les Ind[ée]pendants/i, "Les Indépendants"],
  [/^[ÉE]cologiste - Solidarit[ée]/i, "GEST"],
  [/^Rassemblement des d[ée]mocrates, progressistes/i, "RDPI"],
  [/^Rassemblement D[ée]mocratique et Social/i, "RDSE"],
  [/^Union Nationale pour les Territoires/i, "UNT"],
];

export type FicheSenat = {
  groupe: string | null;          // code (SER, UC…) ou « NI » pour les non-inscrits
  groupeLibelle: string | null;   // intitulé complet, tel qu'affiché par le Sénat
  lien: "membre" | "apparente" | "rattache" | null;
  commission: string | null;
  profession: string | null;
  email: string | null;
  texte: string;                  // état civil, profession, mandats et fonctions antérieures
};

export async function lireFicheSenat(url: string): Promise<FicheSenat | null> {
  const html = await lire(url);
  if (!html) return null;
  const l = texte(html);

  // Bloc « Fonctions principales » : jusqu'à « Contact » ou « Circonscription ».
  const i0 = l.findIndex((x, i) => x === "Fonctions" && /^principales/.test(l[i + 1] || ""));
  let fonctions = "";
  if (i0 >= 0) {
    const fin = l.findIndex((x, i) => i > i0 && /^(Contact|Circonscription)/.test(x));
    fonctions = l.slice(i0 + 2, fin > 0 ? fin : i0 + 25).join(" ").replace(/\s+/g, " ");
  }
  let groupe: string | null = null, groupeLibelle: string | null = null, lien: FicheSenat["lien"] = null;
  if (/ne figurant sur la liste d.aucun groupe/i.test(fonctions)) { groupe = "NI"; groupeLibelle = "Non inscrit"; }
  else {
    const m = fonctions.match(/(Membre|Pr[ée]sidente? |Vice-pr[ée]sidente? |Apparent[ée]e?|Rattach[ée]e?)\s*(?:du|au|de)\s+groupe\s+(.+?)(?=\s+(?:Membre|Pr[ée]sident|Vice-pr[ée]sident|Secr[ée]taire|Questeur)\b|$)/i);
    if (m) {
      // « Membre du groupe du Rassemblement… », suivi parfois d'une autre fonction.
      groupeLibelle = m[2].replace(/^(?:du|de la|des|de l['’])\s*/i, "").replace(/\s+Charg[ée]e? d['’]une mission.*$/i, "").trim();
      groupe = GROUPES.find(([re]) => re.test(groupeLibelle!))?.[1] ?? groupeLibelle;
      lien = /^apparent/i.test(m[1]) ? "apparente" : /^rattach/i.test(m[1]) ? "rattache" : "membre";
    }
  }
  const c = fonctions.match(/(?:Membre|Pr[ée]sidente?|Vice-pr[ée]sidente?|Secr[ée]taire|Rapporteure?(?: g[ée]n[ée]rale?)?)\s+de la (commission (?:des|de la|de l'|du)\s.+?)(?=\s+(?:Membre|Pr[ée]sident|Vice-pr[ée]sident|Secr[ée]taire|Rapporteur)\b|$)/i);
  const commission = c ? c[1].replace(/^c/, "C").trim() : null;

  // Corps de la fiche : de l'en-tête « Sénateur/Sénatrice de … » à « Page mise à jour ».
  const debut = l.findIndex(x => /^S[ée]nat(eur|rice) (de|du|des|d’|d')/i.test(x));
  const fin = l.findIndex((x, i) => i > debut && /^Page mise à jour/i.test(x));
  const corps = debut >= 0
    ? l.slice(Math.max(0, debut - 1), fin > 0 ? fin : debut + 80)
        .filter(x => !/^(Extrait de la|table nominative|Résumé de|l'ensemble des travaux|Sélectionnez|une année|Consulter le|tableau des activités|Voir|le tableau|Travaux parlementaires|Vidéos|Circonscription)$/i.test(x))
        .join("\n")
    : "";
  const iProf = l.findIndex(x => /^Profession\s*:/i.test(x));
  const profession = iProf >= 0 ? (l[iProf].replace(/^Profession\s*:\s*/i, "") || l[iProf + 1] || "").trim() || null : null;
  const email = [...html.matchAll(/mailto:([^"?]+)/gi)].map(m => m[1]).find(m => !/^notices-/i.test(m)) ?? null;
  return { groupe, groupeLibelle, lien, commission, profession, email, texte: corps };
}
