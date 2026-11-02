import { parse } from "csv-parse/sync";
import { chargerAMO10 } from "./fiche-an.js";
import { telecharger } from "./telechargement.js";

/**
 * Les fonctions des élus d'après les seules sources officielles, gratuites et sans IA :
 *   - Sénat : ODSEN (Bureau, commissions, délégations, groupes, mandats locaux) ;
 *   - Assemblée nationale : AMO10 (députés actifs, avec leurs mandats en cours) ;
 *   - Parlement européen : API open data, une demande par député français.
 * Chaque chargeur renvoie la photographie complète d'une catégorie d'élus, ou échoue :
 * une source tronquée ne doit jamais faire croire que des élus ont perdu leurs fonctions.
 */
export type Fonction = {
  elu_kind: "depute" | "senateur" | "eurodepute" | "maire"; elu_slug: string; nom: string;
  categorie: "mandat" | "bureau" | "groupe" | "commission" | "organe" | "mandat_local";
  cle: string; libelle: string; qualite: string | null; organe: string | null; depuis: string | null;
  important: boolean; source_url: string;
};

const sansAccent = (t: string) => (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const jour = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);
const liste = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);

const FEMININS: [RegExp, string][] = [[/^Vice-Pr[ée]sident$/i, "Vice-présidente"], [/^Premier Vice-Pr[ée]sident$/i, "Première vice-présidente"], [/^Pr[ée]sident$/i, "Présidente"], [/^Questeur$/i, "Questeure"], [/^Rapporteur g[ée]n[ée]ral$/i, "Rapporteure générale"]];
const MASCULINS: [RegExp, string][] = [[/^Vice-Pr[ée]sident$/i, "Vice-président"], [/^Premier Vice-Pr[ée]sident$/i, "Premier vice-président"], [/^Pr[ée]sident$/i, "Président"], [/^Questeur$/i, "Questeur"], [/^Rapporteur g[ée]n[ée]ral$/i, "Rapporteur général"]];
/** « Vice-Président » → « Vice-présidente » pour une élue : les fichiers n'accordent pas toujours. */
function qualiteAccordee(q: string, femme: boolean): string {
  for (const [re, t] of femme ? FEMININS : MASCULINS) if (re.test(q.trim())) return t;
  return q.trim();
}
/** « Membre » ne mérite pas le journal, sauf dans une commission permanente. */
const estResponsabilite = (q: string | null) => !!q && !/^membre|suppl[ée]ant|titulaire|député non-inscrit/i.test(q.trim());

// ── Sénat ──────────────────────────────────────────────────────────────────────────────────────
const ODSEN = "https://data.senat.fr/data/senateurs";
const SOURCE_SENAT = "https://data.senat.fr/les-senateurs/";

async function lireOdsen(fichier: string): Promise<Record<string, string>[]> {
  const brut = await telecharger(`${ODSEN}/${fichier}.csv`, { delaiMs: 60_000 });
  let texte: string;
  try { texte = new TextDecoder("utf-8", { fatal: true }).decode(brut); } catch { texte = new TextDecoder("latin1").decode(brut); }
  const propre = texte.split(/\r?\n/).filter(l => l && !l.startsWith("%")).join("\n");
  return parse(propre, { columns: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true });
}
/** Une colonne par le début de son nom : les accents des en-têtes varient d'un fichier à l'autre. */
const col = (r: Record<string, string>, debut: string) => {
  const k = Object.keys(r).find(x => sansAccent(x).startsWith(sansAccent(debut)));
  if (!k) throw new Error(`Colonne absente du fichier ODSEN : ${debut}`);
  return (r[k] || "").trim();
};

export async function fonctionsSenateurs(senateurs: { slug: string; senate_matricule: string | null }[]): Promise<Fonction[]> {
  const parMatricule = new Map(senateurs.filter(s => s.senate_matricule).map(s => [s.senate_matricule!, s.slug]));
  const [general, coms, offdel, locaux, groupes] = await Promise.all(["ODSEN_GENERAL", "ODSEN_CUR_COMS", "ODSEN_CUR_OFFDEL", "ODSEN_MANDAT_LOCAL", "ODSEN_HISTOGROUPES"].map(lireOdsen));
  const actifs = general.filter(r => col(r, "Etat") === "ACTIF");
  if (actifs.length < 300) throw new Error(`ODSEN : ${actifs.length} sénateurs actifs seulement`);

  const fiches = new Map<string, { slug: string; nom: string; femme: boolean }>();
  const sortie: Fonction[] = [];
  const ajouter = (mat: string, f: Omit<Fonction, "elu_kind" | "elu_slug" | "nom" | "source_url">) => {
    const fiche = fiches.get(mat);
    if (fiche) sortie.push({ ...f, elu_kind: "senateur", elu_slug: fiche.slug, nom: fiche.nom, source_url: SOURCE_SENAT });
  };
  for (const r of actifs) {
    const mat = col(r, "Matricule"), slug = parMatricule.get(mat);
    if (!slug) { console.log(`::warning::Sénateur actif sans fiche : ${col(r, "Prenom usuel")} ${col(r, "Nom usuel")} (${mat})`); continue; }
    fiches.set(mat, { slug, nom: `${col(r, "Prenom usuel")} ${col(r, "Nom usuel")}`, femme: col(r, "Qualite") === "Mme" });
    const circo = col(r, "Circonscription");
    ajouter(mat, { categorie: "mandat", cle: "senateur", libelle: `${col(r, "Qualite") === "Mme" ? "Sénatrice" : "Sénateur"} (${circo})`, qualite: null, organe: "Sénat", depuis: null, important: true });
    const bureau = col(r, "Fonction au Bureau");
    if (bureau) ajouter(mat, { categorie: "bureau", cle: "bureau", libelle: bureau, qualite: bureau.replace(/ du S[ée]nat$/i, ""), organe: "Bureau du Sénat", depuis: null, important: true });
  }
  for (const r of coms) {
    const mat = col(r, "Matricule"), fiche = fiches.get(mat);
    if (!fiche || col(r, "Fin de fonction") || col(r, "Fin d'appartenance")) continue;
    const q = qualiteAccordee(col(r, "Fonction"), fiche.femme), nomCom = col(r, "Nom commission"), type = col(r, "Type commission");
    if (/^aucune$/i.test(nomCom)) continue;   // le Président du Sénat ne siège dans aucune commission
    const perm = /^Commission permanente/i.test(type);
    ajouter(mat, { categorie: "commission", cle: nomCom, libelle: `${q} de la ${nomCom.replace(/^commission\s+/i, "commission ")}`, qualite: q, organe: nomCom, depuis: jour(col(r, "Debut de fonction")), important: perm || estResponsabilite(q) });
  }
  for (const r of offdel) {
    const mat = col(r, "Matricule"), fiche = fiches.get(mat);
    if (!fiche || col(r, "Fin de fonction") || col(r, "Fin d'appartenance")) continue;
    const q = qualiteAccordee(col(r, "Fonction"), fiche.femme), org = col(r, "Nom organisme");
    ajouter(mat, { categorie: "organe", cle: org, libelle: `${q} : ${org}`, qualite: q, organe: org, depuis: jour(col(r, "Debut de fonction")), important: estResponsabilite(q) });
  }
  for (const r of locaux) {
    const mat = col(r, "Matricule"); if (!fiches.has(mat) || !/^oui$/i.test(col(r, "Mandat en cours"))) continue;
    const article = col(r, "Article organisme");   // « du », « de l' » : l'espace du fichier a été retirée à la lecture
    const q = col(r, "Fonction"), org = `${article}${article && !article.endsWith("'") ? " " : ""}${col(r, "Organisme")}`.trim();
    ajouter(mat, { categorie: "mandat_local", cle: col(r, "Identifiant mandat"), libelle: `${q} ${org}`.trim(), qualite: q, organe: org, depuis: null, important: /^(maire|pr[ée]sident)/i.test(q) });
  }
  for (const r of groupes) {
    const mat = col(r, "Matricule"), fiche = fiches.get(mat);
    if (!fiche || col(r, "Date de fin d'appartenance")) continue;
    const brut = col(r, "Nom court fonction"), org = col(r, "Nom court du groupe");
    // Une même appartenance peut compter plusieurs fonctions successives : seule la dernière reste ouverte.
    if (col(r, "Date de fin de la fonction")) continue;
    const q = qualiteAccordee(brut || "Membre", fiche.femme);
    ajouter(mat, { categorie: "groupe", cle: col(r, "Code du groupe"), libelle: /^groupe\s/i.test(org) ? `${q} du ${org.replace(/^Groupe\s+/i, "groupe ")}` : `${q} : ${org}`, qualite: q, organe: org, depuis: jour(col(r, "Date de debut de la fonction")) ?? jour(col(r, "Date de debut d'appartenance")), important: true });
  }
  return sortie;
}

// ── Assemblée nationale ────────────────────────────────────────────────────────────────────────
const SOURCE_AN = "https://data.assemblee-nationale.fr/acteurs/deputes-en-exercice";
const TYPES_AN: Record<string, { categorie: Fonction["categorie"]; de: string }> = {
  COMPER: { categorie: "commission", de: "de la" }, DELEG: { categorie: "organe", de: ":" }, DELEGBUREAU: { categorie: "organe", de: ":" },
  OFFPAR: { categorie: "organe", de: ":" }, MISINFO: { categorie: "organe", de: ":" }, MISINFOPRE: { categorie: "organe", de: ":" },
  MISINFOCOM: { categorie: "organe", de: ":" }, COMNL: { categorie: "organe", de: ":" }, CNPE: { categorie: "organe", de: ":" }, CNPS: { categorie: "organe", de: ":" },
};

export async function fonctionsDeputes(deputes: { slug: string; an_id: string | null; first_name: string | null; last_name: string | null }[]): Promise<Fonction[]> {
  // Le serveur de l'Assemblée coupe parfois la connexion : la photographie n'est prise que si elle est complète.
  let an: Awaited<ReturnType<typeof chargerAMO10>> | null = null;
  for (let essai = 1; essai <= 4 && !an; essai++) {
    try { an = await chargerAMO10(); }
    catch (e: any) { console.log(`::warning::AMO10 : essai ${essai}/4 en échec (${e?.message})`); if (essai < 4) await new Promise(f => setTimeout(f, essai * 30_000)); }
  }
  if (!an) throw new Error("AMO10 injoignable");
  const parId = new Map(deputes.filter(d => d.an_id).map(d => [d.an_id!, d]));
  const sortie: Fonction[] = [];
  let actifs = 0;
  for (const [uid, a] of an.acteurs) {
    const mandats = liste<any>(a?.mandats?.mandat).filter(m => typeof m?.dateFin !== "string" || !m.dateFin.trim());
    if (!mandats.some(m => m.typeOrgane === "ASSEMBLEE")) continue;
    actifs++;
    const d = parId.get(uid);
    if (!d) { console.log(`::warning::Député actif sans fiche : ${uid}`); continue; }
    const ident = a?.etatCivil?.ident ?? {};
    const femme = /^mme/i.test(String(ident.civ ?? ""));
    const nom = `${ident.prenom ?? d.first_name ?? ""} ${ident.nom ?? d.last_name ?? ""}`.trim();
    const base = { elu_kind: "depute" as const, elu_slug: d.slug, nom, source_url: SOURCE_AN };
    for (const m of mandats) {
      const ref = liste<any>(m.organes?.organeRef)[0];
      const org = typeof ref === "string" ? an.organes.get(ref) : null;
      const brut = typeof m.infosQualite?.codeQualite === "string" ? m.infosQualite.codeQualite : "";
      const q = qualiteAccordee(brut || "Membre", femme), depuis = jour(m.dateDebut);
      if (m.typeOrgane === "ASSEMBLEE") {
          sortie.push({ ...base, categorie: "mandat", cle: "depute", libelle: femme ? "Députée" : "Député", qualite: null, organe: "Assemblée nationale", depuis, important: true });
      } else if (m.typeOrgane === "BUREAU") {
        // Les « Président d'âge » et « Secrétaire d'âge » n'existent que pour la séance d'ouverture.
        if (/d'[âa]ge/i.test(brut)) continue;
        const accord = /secr/i.test(q) ? "Secrétaire" : q;
        sortie.push({ ...base, categorie: "bureau", cle: "bureau", libelle: `${accord} de l'Assemblée nationale`, qualite: accord, organe: "Bureau de l'Assemblée nationale", depuis, important: true });
      } else if (m.typeOrgane === "GP") {
        const lib = org?.libelle ?? "groupe";
        sortie.push({ ...base, categorie: "groupe", cle: ref, libelle: /non-inscrit/i.test(brut) ? `${femme ? "Députée non inscrite" : "Député non inscrit"}` : `${q} du groupe ${lib}`, qualite: q, organe: lib, depuis, important: true });
      } else if (TYPES_AN[m.typeOrgane] && org) {
        const t = TYPES_AN[m.typeOrgane];
        const libelle = t.de === ":" ? `${q} : ${org.libelle}` : `${q} de la ${org.libelle.replace(/^Commission/, "commission")}`;
        sortie.push({ ...base, categorie: t.categorie, cle: ref, libelle, qualite: q, organe: org.libelle, depuis, important: m.typeOrgane === "COMPER" || estResponsabilite(q) });
      }
    }
  }
  if (actifs < 500) throw new Error(`AMO10 : ${actifs} députés actifs seulement`);
  return sortie;
}

// ── Parlement européen ─────────────────────────────────────────────────────────────────────────
const EP = "https://data.europarl.europa.eu/api/v2";
const ROLES_EP: Record<string, string> = {
  CHAIR: "Président", VICE_CHAIR: "Vice-président", CHAIR_CO: "Coprésident", CO_CHAIR: "Coprésident", PRESIDENT: "Président", VICE_PRESIDENT: "Vice-président", QUAESTOR: "Questeur",
  MEMBER: "Membre", SUBSTITUTE: "Suppléant", MEMBER_SUBSTITUTE: "Suppléant", TREASURER: "Trésorier", MEMBER_BUREAU: "Membre du bureau",
  PRESIDENT_VICE: "Vice-président", CHAIR_VICE: "Vice-président", VICE_CHAIR_FIRST: "Premier vice-président", CHAIR_VICE_FIRST: "Premier vice-président", TREASURER_CO: "Cotrésorier", MEMBER_BUREAU_GROUP: "Membre du bureau",
};
const COPRESIDENT: [RegExp, string][] = [[/^Copr[ée]sident$/i, "Coprésidente"], [/^Suppl[ée]ant$/i, "Suppléante"], [/^Tr[ée]sorier$/i, "Trésorière"]];
const epJson = async (chemin: string) => JSON.parse((await telecharger(`${EP}/${chemin}${chemin.includes("?") ? "&" : "?"}format=application%2Fld%2Bjson`, { essais: 3, delaiMs: 45_000 })).toString("utf8"));

export async function fonctionsEurodeputes(meps: { id: string; slug: string; full_name: string | null; country: string | null }[]): Promise<Fonction[]> {
  const francais = meps.filter(m => m.country === "France" && m.id);
  const courants = await epJson("meps/show-current?limit=1000");
  const enCours = new Set<string>((courants?.data ?? []).map((m: any) => String(m.identifier)));
  if (enCours.size < 650) throw new Error(`Parlement européen : ${enCours.size} députés dans la liste`);

  const libelles = new Map<string, string>();
  const libelleDe = async (org: string) => {
    if (libelles.has(org)) return libelles.get(org)!;
    let lib = org;
    try {
      const d = (await epJson(`corporate-bodies/${org.replace(/^org\//, "")}`)).data?.[0];
      lib = d?.altLabel?.fr ?? d?.prefLabel?.fr ?? (typeof d?.label === "string" ? d.label : org);
    } catch { /* libellé indisponible : le code reste, la ligne ne sera pas perdue */ }
    libelles.set(org, lib);
    return lib;
  };

  const sortie: Fonction[] = [];
  let lus = 0;
  for (const m of francais) {
    if (!enCours.has(String(m.id))) continue;   // sortant : plus de ligne, le retrait ira au journal
    const fiche = (await epJson(`meps/${m.id}`)).data?.[0];
    if (!fiche) throw new Error(`Parlement européen : fiche ${m.id} vide`);
    lus++;
    const femme = /FEMALE/.test(String(fiche.hasGender ?? ""));
    const nom = m.full_name ?? "";
    const base = { elu_kind: "eurodepute" as const, elu_slug: m.slug, nom, source_url: `https://www.europarl.europa.eu/meps/fr/${m.id}` };
    for (const a of liste<any>(fiche.hasMembership)) {
      if (a?.memberDuring?.endDate) continue;
      const genre = String(a.membershipClassification ?? "").split("/").pop() ?? "";
      const role = String(a.role ?? "").split("/").pop() ?? "";
      const org = String(a.organization ?? "");
      if (role === "MEMBER_PARLIAMENT") continue;   // doublon de la ligne « membre » du Parlement
      if (!ROLES_EP[role]) { console.log(`::warning::Parlement européen : rôle inconnu ${role} (${genre}), ligne écartée.`); continue; }
      const accord = femme ? COPRESIDENT.find(([re]) => re.test(ROLES_EP[role]))?.[1] : null;
      const q = accord ?? qualiteAccordee(ROLES_EP[role], femme);
      const depuis = jour(a.memberDuring?.startDate);
      if (genre === "EU_INSTITUTION") {
        if (role === "MEMBER") sortie.push({ ...base, categorie: "mandat", cle: "eurodepute", libelle: femme ? "Députée européenne" : "Député européen", qualite: null, organe: "Parlement européen", depuis, important: true });
        else sortie.push({ ...base, categorie: "bureau", cle: role, libelle: `${q} du Parlement européen`, qualite: q, organe: "Parlement européen", depuis, important: true });
      } else if (genre === "EU_POLITICAL_GROUP") {
        const lib = await libelleDe(org);
        sortie.push({ ...base, categorie: "groupe", cle: `${org}|${role}`, libelle: `${q} du groupe ${lib}`, qualite: q, organe: lib, depuis, important: true });
      } else if (genre === "COMMITTEE_PARLIAMENTARY_STANDING" || genre === "COMMITTEE_PARLIAMENTARY_SPECIAL" || genre === "COMMITTEE_PARLIAMENTARY_TEMPORARY") {
        const lib = await libelleDe(org);
        sortie.push({ ...base, categorie: "commission", cle: `${org}|${role}`, libelle: `${q} : ${lib}`, qualite: q, organe: lib, depuis, important: role !== "SUBSTITUTE" });
      } else if (genre.startsWith("DELEGATION")) {
        const lib = await libelleDe(org);
        sortie.push({ ...base, categorie: "organe", cle: `${org}|${role}`, libelle: `${q} : ${lib}`, qualite: q, organe: lib, depuis, important: estResponsabilite(q) });
      }
    }
    await new Promise(f => setTimeout(f, 700));
  }
  if (lus < 60) throw new Error(`Parlement européen : ${lus} fiches françaises lues`);
  return sortie;
}
