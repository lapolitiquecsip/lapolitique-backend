import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { supabase } from "../../config/supabase.js";

/**
 * Sanctions prononcées par le Conseil constitutionnel, juge des élections nationales :
 * inéligibilité, démission d'office, élection annulée, déchéance de plein droit, rejet du
 * compte de campagne présidentiel. Source : base CONSTIT de la DILA (données ouvertes,
 * stock + mises à jour). Aucune IA : les noms, durées et motifs sont lus dans le dispositif.
 *
 * Rattachement aux fiches du site, prudent (homonymes) :
 *  - députés, sénateurs, maires, présidents de département : prénom + nom + département ;
 *  - candidats, ministres, eurodéputés : prénom + nom, seulement pour les décisions qui
 *    les visent nommément au niveau national (compte présidentiel, déchéance).
 *
 * Usage : npx tsx src/scripts/data/sanctions-conseil-constitutionnel.ts [--local=dossier]
 */
const BASE = "https://echanges.dila.gouv.fr/OPENDATA/CONSTIT/";
const LOCAL = process.argv.find(a => a.startsWith("--local="))?.split("=")[1];
const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

async function telecharger(): Promise<string> {
  if (LOCAL) return LOCAL;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "constit-"));
  const liste = await (await fetch(BASE)).text();
  const fichiers = [...new Set([...liste.matchAll(/href="((?:Freemium_constit_global|CONSTIT)_[\d-]+\.tar\.gz)"/g)].map(m => m[1]))].sort((a, b) =>
    (a.startsWith("Freemium") ? 0 : 1) - (b.startsWith("Freemium") ? 0 : 1) || a.localeCompare(b));
  for (const f of fichiers) {
    const r = await fetch(BASE + f);
    if (!r.ok) continue;
    const cible = path.join(dossier, f);
    fs.writeFileSync(cible, Buffer.from(await r.arrayBuffer()));
    execFileSync("tar", ["xzf", f], { cwd: dossier });   // les mises à jour écrasent le stock (chemin relatif : le tar de Windows prend « C: » pour un hôte)
    fs.rmSync(cible);
  }
  console.log(`> ${fichiers.length} archive(s) CONSTIT.`);
  return dossier;
}

function* xmls(dossier: string): Generator<string> {
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) yield* xmls(p);
    else if (e.name.endsWith(".xml") && e.name.startsWith("CONSTEXT")) yield p;
  }
}

const tag = (t: string, n: string) => decode(t.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`))?.[1]?.trim() || "");
const NOM = String.raw`(?:M\.|Mme|MM\.|Monsieur|Madame)\s+((?:[A-ZÉÈÎ][a-zéèëêïîôöüç'-]+[\s-]+){1,3})([A-ZÉÈÀÂÇÏÎÔÙÛ'][A-ZÉÈÀÂÇÏÎÔÙÛ'\- ]*[A-ZÉÈÀÂÇÏÎÔÙÛ]|[A-ZÉ][a-zéèëêïîôöüç'-]+)`;

/** Département de l'élection, lu dans le titre (« A.N., Seine-Maritime (9ème circ.) »). */
function departement(titre: string): string | null {
  const t = titre.replace(/^(A\.N\.|AN|Sénat|SEN)\s*,\s*/i, "").replace(/\(.*$/, "").split(",")[0].trim();
  return t && t.length < 60 && !/^(demande|décision|situation)/i.test(t) ? t : null;
}

function motif(texte: string, nature: string): string | null {
  const t = texte.toLowerCase();
  if (nature === "D") return "Condamnation pénale entraînant l'inéligibilité";
  if (/(a |à bon droit )?rejet[ée]?\s+(le|son) compte de campagne|compte de campagne[^.]{0,80}(est|a été) rejeté/.test(t)) {
    return "Compte de campagne rejeté";
  }
  if (/n'a pas déposé (son|de) compte de campagne|absence de dépôt du compte/.test(t)) return "Compte de campagne non déposé";
  if (/dépassement du plafond/.test(t)) return "Dépassement du plafond des dépenses de campagne";
  if (/déclaration de situation patrimoniale|déclaration de patrimoine/.test(t)) return "Déclaration de patrimoine non déposée";
  if (/mandataire financier/.test(t)) return "Irrégularité liée au mandataire financier";
  return null;
}

type Sanction = { cle: string; numero: string; nature: string; date_dec: string; circonscription: string; departement: string | null; solution: string;
  civilite: string; prenom: string; nom: string; sanction: string; motif: string | null; url: string; etiquette?: string | null; elu?: boolean; extrait?: string };

function analyser(xml: string): Sanction[] {
  const nature = tag(xml, "NATURE");
  const solution = tag(xml, "SOLUTION");
  if (!["AN", "SEN", "D", "PDR"].includes(nature)) return [];
  if (!/In[ée]ligibilit[ée]|Annulation|D[ée]ch[ée]ance|Rejet du compte/.test(solution)) return [];
  const contenu = decode(xml.split("<CONTENU>")[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const i = contenu.search(/D\s?[ÉE]\s?C\s?I\s?D\s?E|D[ée]clare\s*:/);
  const dispo = i > 0 ? contenu.slice(i, i + 2500).split(/Délibéré par le Conseil/)[0] : contenu.slice(-2500);
  const numero = `${tag(xml, "NUMERO")} ${nature}`;
  const titre = tag(xml, "TITRE");
  const url = (tag(xml, "URL_CC") || `https://www.conseil-constitutionnel.fr/decision/${tag(xml, "DATE_DEC").slice(0, 4)}/${tag(xml, "NUMERO").replace(/-/g, "")}${nature}.htm`).replace(/^http:/, "https:");
  const base = { numero, nature, date_dec: tag(xml, "DATE_DEC"), circonscription: titre.slice(0, 200), departement: nature === "PDR" || nature === "D" ? null : departement(titre),
    solution, motif: motif(contenu, nature), url };

  const parPersonne = new Map<string, Sanction>();
  const ajouter = (civ: string, prenom: string, nom: string, libelle: string) => {
    const k = norm(`${prenom} ${nom}`);
    const deja = parPersonne.get(k);
    if (deja) { if (!deja.sanction.includes(libelle)) deja.sanction += ` ; ${libelle}`; return; }
    parPersonne.set(k, { ...base, cle: `${numero}|${k}`, civilite: /^M(\.|onsieur)/.test(civ) ? "M." : "Mme", prenom: prenom.trim(), nom: nom.trim(), sanction: libelle });
  };
  const civ = (s: string) => (s.match(/^(M\.|Mme|MM\.|Monsieur|Madame)/)?.[1] || "M.");

  // La durée suit souvent « en application de l'article L.O. 136-1 » : on ne s'arrête pas au point de « L.O. ».
  for (const m of dispo.matchAll(new RegExp(`(${NOM})\\s+est\\s+déclarée?\\s+inéligible(?:[\\s\\S]{0,220}?pour une durée d(?:e |[’'])(un an|une année|deux ans|trois ans|cinq ans|dix ans|\\d+ (?:ans|mois)))?`, "g")))
    ajouter(civ(m[1]), m[2], m[3], `Inéligibilité${m[4] ? ` pour ${m[4].replace(/^une année$/, "un an")}` : ""}`);
  for (const m of dispo.matchAll(new RegExp(`(${NOM})\\s+est\\s+déclarée?\\s+démissionnaire d[’']office`, "g")))
    ajouter(civ(m[1]), m[2], m[3], "Démission d'office");
  // Mme GIRARDIN est déclarée démissionnaire d'office : nom seul, rattaché à la personne déjà nommée.
  for (const m of dispo.matchAll(/(?:M\.|Mme)\s+([A-ZÉÈÀÂÇÏÎÔÙÛ'][A-ZÉÈÀÂÇÏÎÔÙÛ'\- ]*[A-ZÉÈÀÂÇÏÎÔÙÛ])\s+est\s+déclarée?\s+démissionnaire d[’']office/g)) {
    const p = [...parPersonne.values()].find(x => norm(x.nom) === norm(m[1]));
    if (p && !p.sanction.includes("Démission")) p.sanction += " ; Démission d'office";
  }
  for (const m of dispo.matchAll(new RegExp(`[ée]lection de (${NOM})[^.]{0,160}?est annulée`, "g")))
    ajouter(civ(m[1]), m[2], m[3], "Élection annulée");
  for (const m of dispo.matchAll(new RegExp(`déchéance de plein droit de (${NOM})`, "g")))
    ajouter(civ(m[1]), m[2], m[3], "Déchéance de son mandat");
  for (const m of dispo.matchAll(new RegExp(`compte de campagne (?:déposé [^.]{0,60}?par |de )(${NOM})[^.]{0,60}?est rejeté`, "g")))
    ajouter(civ(m[1]), m[2], m[3], "Compte de campagne présidentiel rejeté");
  // Étiquette politique citée par la décision (« Mme Sandrine ROUSSEAU, candidate (Divers droite) ») :
  // elle sert à écarter les homonymes, parfois candidats dans la même circonscription.
  for (const p of parPersonne.values()) {
    const re = new RegExp(`${p.nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^.;]{0,40}?,\\s*candidate?\\s*\\(([^)]{2,60})\\)`, "i");
    p.etiquette = contenu.match(re)?.[1]?.trim() || null;
    p.elu = /Démission|annulée|Déchéance/.test(p.sanction);
    p.extrait = norm(contenu.slice(0, 2500));   // « demeurant à … » : sert à vérifier la commune d'un maire
  }
  return [...parPersonne.values()];
}

/** Grande famille politique d'une étiquette, pour comparer décision et fiche (null : inconnue). */
function famille(e: string | null | undefined): string | null {
  const t = norm(e || "");
  if (!t) return null;
  // Sigles des groupes parlementaires (Assemblée et Sénat), tels qu'ils figurent sur les fiches.
  const sigle: Record<string, string> = { ecos: "g", soc: "g", gdr: "g", "lfi nfp": "g", lfi: "g", ser: "g", crce: "g", "crce k": "g", gest: "g",
    rn: "ed", udr: "ed", epr: "c", dem: "c", hor: "c", rdpi: "c", uc: "c", inde: "c", dr: "d", lr: "d", "les republicains": "d" };
  if (sigle[t]) return sigle[t];
  if (/rassemblement national|front national|\bfn\b|\brn\b|reconquete|patriotes|debout la france|dlf|union des droites|extreme droite/.test(t)) return "ed";
  if (/lutte ouvriere|npa|anticapitaliste|revolution|extreme gauche/.test(t)) return "eg";
  if (/insoumis|lfi|socialiste|\bps\b|communiste|pcf|ecolog|eelv|verts|divers gauche|dvg|nupes|nfp|radica[lu]x? de gauche|place publique|generation|gauche/.test(t)) return "g";
  if (/modem|democrate|renaissance|en marche|lrem|ensemble|horizons|udi|centr|agir/.test(t)) return "c";
  if (/republicain|\blr\b|ump|rpr|divers droite|dvd|droite|nouvelle energie/.test(t)) return "d";
  return null;
}

async function toutes(table: string, cols: string) {
  const out: any[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from(table).select(cols).range(de, de + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  const dossier = await telecharger();
  const sanctions: Sanction[] = [];
  for (const f of xmls(dossier)) sanctions.push(...analyser(fs.readFileSync(f, "utf8")));
  const uniques = [...new Map(sanctions.map(s => [s.cle, s])).values()];
  console.log(`> ${uniques.length} sanction(s) nominative(s) lues (${new Set(uniques.map(s => s.numero)).size} décisions).`);
  for (let i = 0; i < uniques.length; i += 500) {
    const { error } = await supabase.from("sanctions_constit").upsert(uniques.slice(i, i + 500).map(({ elu, extrait, ...x }) => x), { onConflict: "cle" });
    if (error) throw error;
  }

  // Rattachement aux fiches.
  const terr = await toutes("territories", "code, name, type");
  const nomDept = new Map(terr.filter((t: any) => !String(t.code).startsWith("R") && t.code.length <= 3).map((t: any) => [String(t.code), t.name]));
  const fiches: { type: string; slug: string; nom: string; dept: string | null; national: boolean; parti?: string | null; commune?: string | null }[] = [];
  for (const d of await toutes("deputies", "slug, first_name, last_name, department, party")) fiches.push({ type: "deputy", slug: d.slug, nom: `${d.first_name} ${d.last_name}`, dept: d.department, national: false, parti: d.party });
  for (const d of await toutes("senators", "slug, first_name, last_name, department, party")) fiches.push({ type: "senator", slug: d.slug, nom: `${d.first_name} ${d.last_name}`, dept: d.department, national: false, parti: d.party });
  for (const d of await toutes("department_presidents", "slug, full_name, dep_name, party")) fiches.push({ type: "department_president", slug: d.slug, nom: d.full_name, dept: d.dep_name, national: false, parti: d.party });
  for (const d of await toutes("mayors", "slug, full_name, insee_code, party, commune_name")) {
    const code = String(d.insee_code || "");
    fiches.push({ type: "mayor", slug: d.slug, nom: d.full_name, dept: nomDept.get(code.startsWith("97") ? code.slice(0, 3) : code.slice(0, 2)) || null, national: false, parti: d.party, commune: d.commune_name });
  }
  for (const d of await toutes("presidential_candidates", "slug, full_name")) fiches.push({ type: "candidate", slug: d.slug, nom: d.full_name, dept: null, national: true });
  for (const d of await toutes("minister_profiles", "slug, full_name")) fiches.push({ type: "minister", slug: d.slug, nom: d.full_name, dept: null, national: true });
  for (const d of await toutes("meps", "slug, full_name")) fiches.push({ type: "mep", slug: d.slug, nom: d.full_name, dept: null, national: true });

  const parNom = new Map<string, typeof fiches>();
  for (const f of fiches) if (f.slug && f.nom) { const k = norm(f.nom); parNom.set(k, [...(parNom.get(k) || []), f]); }
  const liens: any[] = [];
  const ecartes: string[] = [];
  for (const s of uniques) {
    for (const f of parNom.get(norm(`${s.prenom} ${s.nom}`)) || []) {
      const memeDept = !!s.departement && !!f.dept && norm(s.departement) === norm(f.dept);
      const nationale = s.nature === "PDR" || s.nature === "D";
      // Homonyme écarté : la décision cite une famille politique différente de celle de l'élu.
      const fs = famille(s.etiquette), fe = famille(f.parti);
      // Maire : nom courant, le département ne suffit pas — la décision doit citer sa commune.
      if (f.type === "mayor" && !(f.commune && (s.extrait || "").includes(norm(f.commune)))) continue;
      if (fs && fe && fs !== fe) { ecartes.push(`${f.type} ${f.slug} ≠ ${s.numero} (${s.etiquette} / ${f.parti})`); continue; }
      if (f.national ? nationale : (memeDept || (nationale && !s.departement && (f.type === "deputy" || f.type === "senator"))))
        liens.push({ cle: s.cle, entity_type: f.type, entity_slug: f.slug });
    }
  }
  const uniqLiens = [...new Map(liens.map(l => [`${l.cle}|${l.entity_type}|${l.entity_slug}`, l])).values()];
  await supabase.from("sanctions_constit_elus").delete().neq("cle", "");
  for (let i = 0; i < uniqLiens.length; i += 500) await supabase.from("sanctions_constit_elus").insert(uniqLiens.slice(i, i + 500));
  console.log(`> ${ecartes.length} homonyme(s) écarté(s) : ${ecartes.join(" | ")}`);
  console.log(`> ${uniqLiens.length} rattachement(s) à des fiches du site :`);
  for (const l of uniqLiens.slice(0, 40)) { const s = uniques.find(x => x.cle === l.cle)!; console.log(`   ${l.entity_type} ${l.entity_slug} ← ${s.numero} ${s.sanction} (${s.date_dec})`); }
  if (!LOCAL) fs.rmSync(dossier, { recursive: true, force: true });
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
