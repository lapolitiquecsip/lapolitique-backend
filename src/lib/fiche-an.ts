import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";

// Fiche officielle d'un député d'après l'open data de l'Assemblée nationale (AMO10 :
// députés en fonction, leurs mandats et organes). Sert à trois choses :
//  — créer la fiche d'un nouveau député dès son entrée en fonction (sync-deputy-roster),
//    sans attendre le CSV de Datan qui a des semaines de retard ;
//  — remplir l'historique politique et le résultat de 2024 de la circonscription ;
//  — fournir à la bio structurée un texte de référence officiel, comme la fiche senat.fr
//    pour les sénateurs : un suppléant devenu député n'a souvent pas d'article Wikipédia.

export const AMO10_URL = "https://data.assemblee-nationale.fr/static/openData/repository/17/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip";

/** Valeur texte ou null : l'open data AN code les vides par un objet { "@xsi:nil": "true" }. */
const txt = (v: any): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const liste = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);

export type Organe = { uid: string; libelle: string; abrev: string | null; type: string | null };
export type AN = { acteurs: Map<string, any>; organes: Map<string, Organe> };

export async function chargerAMO10(): Promise<AN> {
  const res = await fetch(AMO10_URL, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`AMO10 HTTP ${res.status}`);
  const acteurs = new Map<string, any>(), organes = new Map<string, Organe>();
  for (const e of new AdmZip(Buffer.from(await res.arrayBuffer())).getEntries()) {
    if (!/\.json$/.test(e.entryName)) continue;
    try {
      const j = JSON.parse(e.getData().toString("utf8"));
      if (j.acteur) {
        const u = txt(j.acteur.uid?.["#text"]) || txt(j.acteur.uid);
        if (u?.startsWith("PA")) acteurs.set(u, j.acteur);
      } else if (j.organe) {
        const o = j.organe;
        organes.set(o.uid, { uid: o.uid, libelle: txt(o.libelle) || o.uid, abrev: txt(o.libelleAbrev), type: txt(o.codeType) });
      }
    } catch { /* fichier illisible : ignoré */ }
  }
  return { acteurs, organes };
}

const mandatsDe = (a: any): any[] => liste(a?.mandats?.mandat);

/** Le mandat de député en cours (17e législature). */
export function mandatDepute(a: any): any | null {
  return mandatsDe(a).find(m => m.typeOrgane === "ASSEMBLEE" && !txt(m.dateFin)) ?? null;
}

/** Groupe politique en cours : abréviation AN et libellé. */
export function groupeDe(a: any, an: AN): Organe | null {
  const m = mandatsDe(a).find(x => x.typeOrgane === "GP" && !txt(x.dateFin));
  return m ? an.organes.get(txt(m.organes?.organeRef) || "") ?? null : null;
}

/** Abréviations AN → valeurs déjà employées en base (le site groupe et colore sur ces valeurs). */
export const PARTI_BASE: Record<string, { party: string; color: string }> = {
  RN: { party: "RN", color: "#153063" }, EPR: { party: "EPR", color: "#ff7900" },
  "LFI-NFP": { party: "LFI-NFP", color: "#cc241d" }, SOC: { party: "SOC", color: "#e1001a" },
  DR: { party: "DR", color: "#0050a4" }, ECOS: { party: "EcoS", color: "#00a84d" },
  DEM: { party: "Dem", color: "#ee7e37" }, HOR: { party: "HOR", color: "#00a2e8" },
  LIOT: { party: "LIOT", color: "#9b9b9b" }, UDDPLR: { party: "UDR", color: "#2c3e50" },
  UDR: { party: "UDR", color: "#2c3e50" }, GDR: { party: "GDR", color: "#dd0000" },
  NI: { party: "NI", color: "#95A5A6" },
};

/** Historique politique, au format déjà affiché par le site (enrich-deputy-history). */
export function historiquePolitique(a: any, an: AN) {
  return mandatsDe(a)
    .filter(m => txt(m.dateDebut))
    .map(m => {
      const ref = txt(m.organes?.organeRef);
      return {
        type: m.typeOrgane,
        label: txt(m.infosQualite?.libQualite) || "Membre",
        startDate: txt(m.dateDebut),
        endDate: txt(m.dateFin),
        legislature: txt(m.legislature),
        organe: ref ? an.organes.get(ref)?.libelle ?? ref : null,
      };
    })
    .sort((x, y) => String(y.startDate).localeCompare(String(x.startDate)));
}

/** Entré à l'Assemblée par une élection partielle (et non comme suppléant, ni par une reprise). */
export const parElectionPartielle = (a: any) => /partielle/i.test(txt(mandatDepute(a)?.election?.causeMandat) || "");

const dateFr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "");

/** Texte de référence officiel, pour la bio structurée. Uniquement des faits de l'open data. */
export function ficheOfficielle(a: any, an: AN): string {
  const id = a.etatCivil?.ident ?? {}, nais = a.etatCivil?.infoNaissance ?? {};
  const m = mandatDepute(a);
  const lignes: string[] = ["Source : open data de l'Assemblée nationale (fiche officielle du député)."];
  lignes.push(`Nom : ${[txt(id.civ), txt(id.prenom), txt(id.nom)].filter(Boolean).join(" ")}`);
  const lieu = [txt(nais.villeNais), txt(nais.depNais) && `(${txt(nais.depNais)})`, txt(nais.paysNais)].filter(Boolean).join(" ");
  if (txt(nais.dateNais)) lignes.push(`Naissance : le ${dateFr(txt(nais.dateNais))}${lieu ? ` à ${lieu}` : ""}`);
  const prof = txt(a.profession?.libelleCourant), cat = txt(a.profession?.socProcINSEE?.catSocPro);
  if (prof || cat) lignes.push(`Profession déclarée : ${[prof, cat && `catégorie INSEE : ${cat}`].filter(Boolean).join(" ; ")}`);
  if (m) {
    const l = m.election?.lieu ?? {};
    lignes.push(`Mandat de député (17e législature) : ${txt(l.numCirco)}e circonscription ${txt(l.departement) ? `— ${txt(l.departement)}` : ""}`);
    if (txt(m.mandature?.datePriseFonction)) lignes.push(`Prise de fonction : le ${dateFr(txt(m.mandature?.datePriseFonction))}`);
    if (txt(m.election?.causeMandat)) lignes.push(`Motif de l'entrée en fonction : ${txt(m.election?.causeMandat)}`);
    if (txt(m.mandature?.premiereElection)) lignes.push(`Premier mandat de député : ${txt(m.mandature?.premiereElection) === "1" ? "oui" : "non"}`);
  }
  const autres = mandatsDe(a).filter(x => x.typeOrgane !== "ASSEMBLEE" && !txt(x.dateFin));
  for (const x of autres) {
    const o = an.organes.get(txt(x.organes?.organeRef) || "");
    if (!o) continue;
    lignes.push(`${txt(x.infosQualite?.libQualite) || "Membre"} — ${o.libelle} (depuis le ${dateFr(txt(x.dateDebut))})`);
  }
  return lignes.join("\n");
}

/* ─────────────── Résultats des législatives 2024 par circonscription ─────────────── */

type Resultat = { department: string; circo: number; candidates: { name: string; party: string; votes: number; percent: string }[] };
let cache: { t1: Resultat[]; t2: Resultat[] } | null = null;

function lireCSV(fichier: string): Resultat[] {
  const out: Resultat[] = [];
  for (const brut of fs.readFileSync(fichier, "utf-8").split("\n").slice(1)) {
    const cols = brut.trim().split(";");
    const dept = cols[1], circo = parseInt(cols[3]?.match(/\d+/)?.[0] || cols[2]?.slice(-2) || "1");
    if (!dept || !circo) continue;
    const candidates = [];
    for (let j = 18; j < cols.length; j += 9) {
      const nom = cols[j + 2], prenom = cols[j + 3], v = cols[j + 5] || "";
      if (!nom || !prenom || !v) continue;
      const votes = parseInt(v.replace(/[^\d]/g, ""));
      candidates.push({ name: `${prenom} ${nom}`, party: (cols[j + 1] || "").replace(/"/g, ""), votes: isNaN(votes) ? 0 : votes, percent: (cols[j + 7] || "").replace(/"/g, "") });
    }
    out.push({ department: dept, circo, candidates: candidates.sort((x, y) => y.votes - x.votes) });
  }
  return out;
}

const normDept = (d: string) => {
  const n = (d || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/-/g, " ");
  if (n === "099" || n.includes("etranger")) return "francais etablis hors de france";
  if (n === "986" || n.includes("wallis")) return "wallis et futuna";
  if (n === "975" || n.includes("saint pierre")) return "saint pierre et miquelon";
  if (n === "977" || n === "978" || n.includes("saint barthelemy") || n.includes("saint martin")) return "saint martin/saint barthelemy";
  return n;
};

/**
 * Résultat 2024 de la circonscription, au format affiché par le site ({ round, candidates }).
 * C'est l'élection qui a désigné le binôme titulaire-suppléant : il vaut pour un suppléant
 * devenu député, pas pour un élu d'une partielle (renvoie alors null, voir l'appelant).
 */
export function resultat2024(department: string, circo: number) {
  if (!cache) {
    const dir = path.join(process.cwd(), "data/elections");
    cache = { t1: lireCSV(path.join(dir, "t1.csv")), t2: lireCSV(path.join(dir, "t2.csv")) };
  }
  const d = normDept(department);
  const t2 = cache.t2.find(r => normDept(r.department) === d && r.circo === circo);
  if (t2) return { round: 2, candidates: t2.candidates.slice(0, 5) };
  const t1 = cache.t1.find(r => normDept(r.department) === d && r.circo === circo);
  return t1 ? { round: 1, candidates: t1.candidates.slice(0, 5) } : null;
}
