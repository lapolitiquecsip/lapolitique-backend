import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { fetchAll, resolveLocation } from "./generate-interest-notifications.js";
import { regionOfDept } from "../../lib/dept-region.js";
import { GROUPES_PARTIS, positionGroupe } from "../../lib/groupes-partis.js";

/**
 * Alertes de textes, deux sortes :
 *
 * • « Chaque texte voté » (Premium et Pro, case cochée : user_preferences.rythmes.textes_votes) :
 *   CHAQUE vote sur un texte, à l'Assemblée comme au Sénat — vote sur l'ensemble, partie
 *   du budget, résolution, motion de rejet ou de censure adoptée —, avec le résultat, le vote
 *   de chaque groupe, de ses élus suivis et de ses partis suivis. Sans plafond ni tri : la
 *   promesse est « dès qu'un texte est voté ». Seuls partent les votes apparus après la case
 *   cochée (rythmes.textes_votes_depuis), pour ne pas déverser l'historique.
 * • Pro « un texte vous concerne » : vote sur l'ensemble, loi ou décret au Journal
 *   officiel, seulement si le texte peut concerner le membre d'après son profil (4 par jour).
 *
 * Un même texte ne fait qu'UNE alerte par membre (clé texte|source|id), quelle que soit la sorte.
 *
 * 1. Chaque nouveau texte est analysé UNE fois (textes_impacts) : publics, secteurs,
 *    domaines, territoire, importance, et une explication accompagnée d'un EXTRAIT
 *    du résumé officiel. L'extrait est vérifié mot pour mot dans la source : s'il n'y
 *    figure pas, l'explication est retirée (rien d'inventé ne part chez un membre).
 * 2. Rapprochement avec chaque profil Pro (situation, âge, logement, enfants, secteur,
 *    centres d'intérêt, territoire) selon des règles fixes, sans IA.
 * 3. Les élus suivis par le membre et leur vote sont joints aux votes finaux.
 *
 * --dry : n'écrit rien (affiche les analyses et les destinataires).
 */
const DRY = process.argv.includes("--dry");
const JOURS = Number(process.env.ALERTES_TEXTES_JOURS || 3);
// Le Sénat publie ses scrutins sur data.gouv avec plusieurs jours de retard : on regarde
// quinze jours en arrière (la clé de chaque alerte empêche tout renvoi).
const JOURS_SENAT = Number(process.env.ALERTES_TEXTES_JOURS_SENAT || 15);
const MAX_PAR_JOUR = 4;
const SITE_URL = process.env.SITE_URL || "https://lapolitiquecestsimple.fr";
const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’'`«»"]/g, "'").replace(/\s+/g, " ").trim();

// Actes sans portée pour le public : jamais analysés.
const ROUTINE = /\b(nominations?|nomm[ée]e?s?|titularisation|admission|cessation de fonctions|fin de fonctions|d[ée]l[ée]gation de signature|promotion|r[ée]int[ée]gration|d[ée]tachement|radiation|naturalisation|changement de nom|composition (du|de la) (conseil|commission|comit[ée])|attribution de la m[ée]daille|l[ée]gion d.honneur|ordre national du m[ée]rite)\b/i;

export const PUBLICS = ["tous", "contribuables", "salaries", "fonctionnaires", "independants", "chefs_entreprise", "agriculteurs", "demandeurs_emploi", "retraites", "etudiants", "jeunes", "seniors", "parents", "locataires", "proprietaires", "automobilistes"];
export const SECTEURS = ["sante", "education", "agriculture", "btp_logement", "commerce_artisanat", "industrie", "transport", "numerique", "culture_medias", "securite_defense", "justice", "social", "energie_environnement", "tourisme_restauration", "finance_assurance", "fonction_publique"];
const DOMAINES = ["economie", "emploi", "retraites", "sante", "education", "ecologie", "agriculture", "securite", "immigration", "europe", "social", "logement", "institutions", "transports", "numerique", "culture"];

type Texte = { source: string; source_id: string; chambre: string; titre: string; resume: string; url: string; date: string; resultat?: any; scrutinId?: string; intitule?: string };

/** Ce que tranche un scrutin de l'Assemblée, ou null si ce n'est pas le vote d'un texte. */
function voteDeTexteAN(s: any): string | null {
  const t = String(s.title || s.objet || "");
  const adopte = /adopt/i.test(s.resultat || "") && !/pas adopt/i.test(s.resultat || "");
  if (s.type === "LOI") {
    if (/prolonger la s[ée]ance|^la proposition du gouvernement/i.test(t)) return null;
    const partie = t.match(/^la (premi[eè]re|seconde|deuxi[eè]me) partie/i);
    return partie ? `Vote sur la ${partie[1].toLowerCase()} partie` : "Vote sur l'ensemble";
  }
  if (s.type === "AUTRE" && /^la proposition de r[ée]solution/i.test(t)) return "Résolution";
  // Une motion adoptée tranche le sort du texte (rejet) ou du Gouvernement (censure).
  if (s.type === "MOTION" && adopte && /motion de rejet/i.test(t)) return "Motion de rejet adoptée : texte rejeté";
  if (/motion de censure/i.test(t)) return adopte ? "Motion de censure adoptée" : "Motion de censure";
  return null;
}
/** « l'ensemble de la proposition de loi visant à… » → « La proposition de loi visant à… ». */
function sujetAN(s: any): string {
  const article: Record<string, string> = { "du ": "le ", "de la ": "la ", "de l'": "l'", "des ": "les " };
  const t = String(s.title || s.objet || "").replace(/^l'ensemble (du |de la |de l'|des )?/i, (_m: string, a?: string) => (a ? article[a.toLowerCase()] : "")).replace(/\.$/, "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ─────────────── 1. Textes nouveaux ─────────────── */

async function textesRecents(): Promise<Texte[]> {
  const depuis = new Date(Date.now() - JOURS * 86400000).toISOString();
  const out: Texte[] = [];

  // Assemblée : la table complète de l'open data AN (votes-sync, chaque nuit). L'ancienne source
  // (legislative_scrutins) n'avait qu'un vote final de l'Assemblée sur dix : le PLF, le PLFSS et
  // les lois organiques n'y figuraient pas, et ne déclenchaient aucune alerte.
  const depuisVote = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const an = (await fetchAll("scrutins", "id, numero, date_scrutin, title, objet, resultat, type, group_results, pour, contre, abstention, summary, why_it_matters",
    q => q.eq("institution", "AN").in("type", ["LOI", "AUTRE", "MOTION"]).gte("created_at", depuis).gte("date_scrutin", depuisVote)))
    .filter((s: any) => voteDeTexteAN(s));
  const navette = new Map<string, string>();
  if (an.length) {
    const { data } = await supabase.from("scrutin_navette").select("scrutin_id, dossier_id").in("scrutin_id", an.map((s: any) => s.id));
    for (const n of data || []) navette.set(n.scrutin_id, n.dossier_id);
  }
  for (const s of an) {
    const adopte = /adopt/i.test(s.resultat || "") && !/pas adopt/i.test(s.resultat || "");
    out.push({
      source: "scrutin_final", source_id: String(s.id), chambre: "AN", scrutinId: String(s.id), intitule: voteDeTexteAN(s)!,
      titre: sujetAN(s), resume: [s.summary, s.why_it_matters].filter(Boolean).join("\n\n").slice(0, 6000),
      url: navette.get(s.id) ? `${SITE_URL}/lois/?dossier=${navette.get(s.id)}` : `https://www.assemblee-nationale.fr/dyn/17/scrutins/${s.numero}`, date: s.date_scrutin,
      resultat: { adopte, libelle: s.resultat, pour: s.pour, contre: s.contre, abstention: s.abstention,
        groupes: (s.group_results || []).filter((g: any) => (g.pour || 0) + (g.contre || 0) + (g.abstention || 0) > 0)
          .map((g: any) => ({ code: g.group_id, nom: g.group_label || "Autre", pour: g.pour || 0, contre: g.contre || 0, abstention: g.abstention || 0 }))
          .sort((a: any, b: any) => (b.pour + b.contre + b.abstention) - (a.pour + a.contre + a.abstention)) },
    });
  }

  // Sénat : votes sur l'ensemble (legislative_scrutins).
  const depuisSenat = new Date(Date.now() - JOURS_SENAT * 86400000).toISOString();
  const scrutins = await fetchAll("legislative_scrutins", "id, official_id, dossier_id, chamber, title, result_label, for_count, against_count, abstain_count, voted_at, source_url, explanation",
    q => q.eq("chamber", "SENAT").gte("voted_at", depuisSenat).ilike("title", "%ensemble%"));
  const groupeDuSenateur = new Map((await fetchAll("senators", "senate_matricule, senate_group", q => q.not("senate_matricule", "is", null)))
    .map((x: any) => [String(x.senate_matricule).toUpperCase(), x.senate_group || "Autre"]));
  const dossiers = [...new Set(scrutins.map((s: any) => s.dossier_id).filter(Boolean))];
  const resumes = new Map<string, string>();
  if (dossiers.length) {
    const { data } = await supabase.from("legislative_analyses").select("dossier_id, summary, audience").in("dossier_id", dossiers);
    for (const a of data || []) if (!resumes.has(a.dossier_id) || a.audience === "citizen") resumes.set(a.dossier_id, typeof a.summary === "string" ? a.summary : JSON.stringify(a.summary));
  }
  for (const s of scrutins) {
    // Le décompte par groupe du Sénat en base est incomplet (une seule ligne par scrutin) :
    // on le refait à partir des votes nominatifs, qui sont complets.
    const { data: votes } = await supabase.from("legislative_votes").select("voter_official_id, position").eq("scrutin_id", s.id);
    const parGroupe = new Map<string, { pour: number; contre: number; abstention: number }>();
    for (const v of votes || []) {
      const k = v.position === "for" ? "pour" : v.position === "against" ? "contre" : v.position === "abstain" ? "abstention" : null;
      if (!k) continue;
      const g = groupeDuSenateur.get(String(v.voter_official_id).toUpperCase()) || "Autre";
      const c = parGroupe.get(g) || { pour: 0, contre: 0, abstention: 0 }; c[k]++; parGroupe.set(g, c);
    }
    // Le libellé du résultat est vide au Sénat : adopté = plus de « pour » que de « contre ».
    const adopte = s.result_label ? /adopt/i.test(s.result_label) && !/pas adopt|rejet/i.test(s.result_label) : (s.for_count || 0) > (s.against_count || 0);
    out.push({
      source: "scrutin_final", source_id: String(s.id), chambre: "SENAT", scrutinId: String(s.official_id || s.id), intitule: "Vote sur l'ensemble",
      titre: s.title.replace(/^(sur )?l'ensemble (du |de la |des |de l')?/i, "").replace(/^./, (c: string) => c.toUpperCase()),
      resume: [s.explanation, resumes.get(s.dossier_id)].filter(Boolean).join("\n\n").slice(0, 6000),
      url: s.dossier_id ? `${SITE_URL}/lois/?dossier=${s.dossier_id}` : s.source_url, date: s.voted_at,
      resultat: { adopte, libelle: s.result_label || (adopte ? "Le Sénat a adopté" : "Le Sénat n'a pas adopté"), pour: s.for_count, contre: s.against_count, abstention: s.abstain_count,
        groupes: [...parGroupe].map(([nom, c]) => ({ code: nom, nom, ...c })).sort((a, b) => (b.pour + b.contre + b.abstention) - (a.pour + a.contre + a.abstention)) },
    });
  }

  // Journal officiel : lois et décrets qui ne sont pas des actes de routine.
  //
  // Le texte soumis à l'analyse est l'explication du Journal officiel du jour (jorf_texts) :
  // la NOTICE rédigée par l'administration quand elle existe, sinon un résumé tiré du contenu
  // du texte lui-même. L'ancien « résumé du décret » était, lui, imaginé à partir du seul
  // TITRE : il pouvait affirmer ce que le décret ne dit pas, et l'extrait « vérifié mot pour
  // mot » l'était alors contre une invention. Il manquait en outre à deux décrets sur trois
  // (quota du modèle épuisé la nuit), et un décret sans résumé n'était jamais signalé.
  const depuisDecrets = new Date(Date.now() - Math.max(JOURS, 5) * 86400000).toISOString().slice(0, 10);
  const decrets = await fetchAll("decrees", "jorf_id, title, display_title, summary, source_url, date_publi, nature",
    q => q.gte("date_publi", depuisDecrets));
  const officiel = new Map<string, { explication: string; source: string }>();
  for (let i = 0; i < decrets.length; i += 150) {
    const { data } = await supabase.from("jorf_texts").select("id, explication, source_explication")
      .in("id", decrets.slice(i, i + 150).map((d: any) => d.jorf_id));
    for (const t of data || []) {
      if (t.explication && t.source_explication !== "renvoi") officiel.set(t.id, { explication: t.explication, source: t.source_explication });
    }
  }
  for (const d of decrets) {
    if (ROUTINE.test(`${d.title || ""} ${d.display_title || ""}`)) continue;
    const jo = officiel.get(d.jorf_id);
    // Sans explication tirée du texte, on attend : elle arrive avec le Journal officiel du jour.
    if (!jo) continue;
    out.push({ source: /loi/i.test(d.nature || "") ? "loi" : "decret", source_id: d.jorf_id, chambre: "JO",
      // Un titre raccourci trop court ne dit plus de quoi il s'agit (« Application de l'article
      // L. 121-6 » — de quel code ?) : on revient alors à l'intitulé officiel complet.
      titre: (d.display_title || "").length >= 45 ? d.display_title : d.title,
      resume: `${d.title}

${jo.explication}`, url: d.source_url, date: d.date_publi });
  }
  return out;
}

/* ─────────────── 2. Analyse (une fois par texte) ─────────────── */

async function analyser(t: Texte) {
  const params = {
    model: "deepseek-chat", max_tokens: 2500, responseFormat: "json_object" as const, sansReflexion: true,
    system: `Tu analyses un texte juridique français (vote d'une loi ou acte publié au Journal officiel) pour savoir QUI il concerne concrètement. Réponds uniquement d'après le texte fourni ; n'invente rien.
Réponds en JSON :
{"importance": 1 à 5 (5 = change une règle pour une grande partie de la population ; 4 = effet concret pour un public large ; 3 = effet pour un public ou un secteur précis ; 2 = effet limité ; 1 = technique, sans effet perceptible),
 "publics": sous-ensemble de ${JSON.stringify(PUBLICS)} (« tous » seulement si chacun est directement concerné),
 "secteurs": sous-ensemble de ${JSON.stringify(SECTEURS)},
 "domaines": sous-ensemble de ${JSON.stringify(DOMAINES)},
 "territoire": "national", ou le code du département (ex. "974") ou "outre-mer" si le texte ne vise qu'un territoire,
 "explication": UNE phrase de 25 mots max, au présent, qui dit concrètement ce que le texte change, sans jugement ; n'y écris PAS qui est concerné (« toute la population », « tous les Français »…) si le texte ne le dit pas,
 "extrait": la phrase (ou le passage, 200 caractères max) du texte fourni qui justifie l'explication, COPIÉE MOT POUR MOT}`,
    messages: [{ role: "user" as const, content: `${t.titre}\n\n${t.resume}` }],
  };
  const lire = (r: any) => { const x = r.content?.[0]?.text ?? ""; const m = x.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; };
  let a: any;
  try { a = lire(await resilientDeepSeek.createMessage(params, { timeoutMs: 75000 })); }
  catch { a = lire(await resilientDeepSeek.createMessage(params, { timeoutMs: 75000, payant: true })); }   // ~0,0003 $ le texte
  if (!a) return null;
  const garde = (l: any, autorises: string[]) => (Array.isArray(l) ? l : []).filter((x: string) => autorises.includes(x));
  // Garde-fou anti-invention : l'extrait doit figurer tel quel dans la source.
  const extrait = String(a.extrait || "").trim();
  const prouve = extrait.length >= 25 && norm(`${t.titre} ${t.resume}`).includes(norm(extrait).replace(/[.…]+$/, ""));
  return {
    importance: Math.max(1, Math.min(5, Number(a.importance) || 1)),
    publics: garde(a.publics, PUBLICS), secteurs: garde(a.secteurs, SECTEURS), domaines: garde(a.domaines, DOMAINES),
    territoire: /^(national|outre-mer|\d{2,3}|2a|2b)$/i.test(String(a.territoire || "")) ? String(a.territoire).toLowerCase() : "national",
    // Formules de portée ajoutées par le modèle, absentes des sources : retirées.
    explication: prouve ? String(a.explication || "").replace(/,?\s*(concernant|pour|qui concerne|touchant)( potentiellement| directement)? (toute la population|l'ensemble de la population|tous les français|l'ensemble des français)\.?$/i, ".").replace(/\.\.$/, ".").slice(0, 240) : null,
    extrait: prouve ? extrait.slice(0, 260) : null,
  };
}

/* ─────────────── 3. Rapprochement avec les profils ─────────────── */

const PUBLICS_DU_STATUT: Record<string, string[]> = {
  etudiant: ["etudiants", "jeunes"], salarie_prive: ["salaries"], fonctionnaire: ["fonctionnaires", "salaries"],
  independant: ["independants", "chefs_entreprise"], demandeur: ["demandeurs_emploi"], retraite: ["retraites", "seniors"],
};
export function publicsDuMembre(p: any): string[] {
  const s = new Set<string>(["tous", "contribuables"]);
  for (const x of PUBLICS_DU_STATUT[p.profession] || []) s.add(x);
  if (p.age_range === "-18" || p.age_range === "18-24") s.add("jeunes");
  if (p.age_range === "65+") s.add("seniors");
  if (p.logement === "locataire") s.add("locataires");
  if (p.logement === "proprietaire") s.add("proprietaires");
  if (p.enfants && p.enfants !== "aucun") s.add("parents");
  if (p.secteur === "agriculture") s.add("agriculteurs");
  return [...s];
}
const LIBELLE_PUBLIC: Record<string, string> = {
  tous: "tout le monde", contribuables: "les contribuables", salaries: "les salariés", fonctionnaires: "les agents publics",
  independants: "les indépendants", chefs_entreprise: "les chefs d'entreprise", agriculteurs: "les agriculteurs",
  demandeurs_emploi: "les demandeurs d'emploi", retraites: "les retraités", etudiants: "les étudiants", jeunes: "les jeunes",
  seniors: "les seniors", parents: "les parents", locataires: "les locataires", proprietaires: "les propriétaires", automobilistes: "les automobilistes",
};

/** Pourquoi ce texte concerne ce membre (vide = il ne le concerne pas assez). */
export function raisons(t: any, p: any, loc: { deptCode: string | null; regionCode: string | null }): string[] {
  if (t.territoire !== "national") {
    const dom = ["971", "972", "973", "974", "976"].includes(loc.deptCode || "");
    if (t.territoire === "outre-mer" ? !dom : t.territoire !== (loc.deptCode || "").toLowerCase()) return [];
  }
  const out: string[] = [];
  // « tous » n'est pas un public précis : il a sa propre règle (importance 4), et le compter ici
  // faisait partir des alertes « Pour vous : il concerne » — sans dire qui.
  const communs = t.publics.filter((x: string) => publicsDuMembre(p).includes(x) && x !== "contribuables" && x !== "tous");
  if (t.publics.includes("tous") && t.importance >= 4) out.push("il concerne tout le monde");
  else if (communs.length && t.importance >= 3) out.push(`il concerne ${communs.filter((x: string) => x !== "tous").map((x: string) => LIBELLE_PUBLIC[x]).join(", ")}`);
  if (p.secteur && t.secteurs.includes(p.secteur) && t.importance >= 3) out.push("il touche votre secteur d'activité");
  if (t.importance >= 4 && (p.interests || []).some((d: string) => t.domaines.includes(d))) out.push("il porte sur un sujet que vous suivez");
  if (t.territoire !== "national") out.push("il vise votre territoire");
  return out;
}

/* ─────────────── Passage ─────────────── */

async function main() {
  const textes = await textesRecents();
  const { data: dejaAnalyses } = await supabase.from("textes_impacts").select("*").in("source_id", textes.map(t => t.source_id));
  const connus = new Map((dejaAnalyses || []).map((a: any) => [`${a.source}|${a.source_id}`, a]));
  console.log(`[Textes] ${textes.length} texte(s) récent(s), ${connus.size} déjà analysé(s).`);

  const maintenant = new Date().toISOString();
  const analyses: any[] = [];
  for (const t of textes) {
    let a = connus.get(`${t.source}|${t.source_id}`);
    if (!a) {
      const r = await analyser(t).catch(e => { console.warn(`  ! ${t.titre.slice(0, 60)} : ${e.message}`); return null; });
      if (r) {
        a = { source: t.source, source_id: t.source_id, chambre: t.chambre, titre: t.titre.slice(0, 400), resume: t.resume.slice(0, 2000), url: t.url, date_texte: t.date, resultat: t.resultat ?? null, ...r };
        if (!DRY) await supabase.from("textes_impacts").upsert(a, { onConflict: "source,source_id" });
        a.analyse_le = maintenant;
        console.log(`  · [${a.importance}] ${a.titre.slice(0, 70)} → ${a.publics.join(",")} | ${a.secteurs.join(",")}${a.explication ? "" : " (explication non prouvée, retirée)"}`);
      } else if (t.source === "scrutin_final") {
        // Analyse impossible (quota) : le vote part quand même chez qui a demandé chaque texte voté,
        // sans explication. Le profil Pro, lui, attend l'analyse au passage suivant.
        a = { source: t.source, source_id: t.source_id, chambre: t.chambre, titre: t.titre, url: t.url, date_texte: t.date, importance: null, explication: null, extrait: null, analyse_le: maintenant };
      } else continue;
    }
    // Le résultat et les groupes viennent toujours du relevé du jour (corrigé depuis l'analyse, au Sénat).
    if (t.source === "scrutin_final") { a.resultat = t.resultat; a.titre = t.titre; a.url = t.url; }
    a.scrutinId = t.scrutinId; a.intitule = t.intitule;
    analyses.push(a);
  }
  const votes = analyses.filter(a => a.source === "scrutin_final");
  const utiles = analyses.filter(a => (a.importance ?? 0) >= 3);
  if (!utiles.length && !votes.length) { console.log("[Textes] Aucun texte d'importance suffisante, aucun vote."); return; }

  // Destinataires : Pro (profil « un texte vous concerne ») et Premium ou Pro ayant coché « chaque texte voté ».
  const niveaux = new Map((await fetchAll("profiles", "id, subscription_tier", q => q.in("subscription_tier", ["elite", "pro"]))).map((p: any) => [p.id, p.subscription_tier]));
  // Essai : ALERTES_TEXTES_SEUL=<id> → ce seul compte (traité comme Pro), personne d'autre.
  const seul = process.env.ALERTES_TEXTES_SEUL;
  if (seul) niveaux.set(seul, "pro");
  const ids = seul ? [seul] : [...niveaux.keys()];
  const prefs = await fetchAll("user_preferences", "user_id, profession, age_range, logement, enfants, secteur, interests, city, department, alertes_textes, rythmes, consentement_suivis", q => q.in("user_id", ids));
  const suivis = await fetchAll("user_follows", "user_id, deputy_id, senator_id", q => q.in("user_id", ids));
  // Partis suivis : seulement avec l'accord explicite du membre (opinion politique, RGPD art. 9).
  const partisSuivis = await fetchAll("user_suivis", "user_id, ref, label", q => q.eq("kind", "parti").in("user_id", ids));
  const deputes = new Map((await fetchAll("deputies", "id, an_id, first_name, last_name, sitting", q => q)).map((d: any) => [d.id, d]));
  const senateurs = new Map((await fetchAll("senators", "id, senate_matricule, first_name, last_name, sitting", q => q)).map((d: any) => [d.id, d]));
  const aujourdhui = new Date().toISOString().slice(0, 10);

  // Votes nominatifs des scrutins retenus, chargés une fois.
  const nominatifs = new Map<string, Map<string, string>>();
  for (const t of votes) {
    const m = new Map<string, string>();
    if (t.chambre === "AN") {
      for (const v of await fetchAll("deputy_votes", "deputy_an_id, position", q => q.eq("scrutin_id", t.scrutinId))) m.set(String(v.deputy_an_id).toUpperCase(), v.position);
    } else {
      for (const v of await fetchAll("legislative_votes", "voter_official_id, position", q => q.eq("scrutin_id", t.source_id))) m.set(String(v.voter_official_id).toUpperCase(), v.position);
    }
    nominatifs.set(t.source_id, m);
  }

  const lignes: any[] = [];
  for (const p of prefs) {
    const niveau = niveaux.get(p.user_id);
    if (!niveau) continue;
    // Essai : ALERTES_TEXTES_ESSAI_VOTES=1 avec ALERTES_TEXTES_SEUL → la case « chaque texte voté » est réputée cochée.
    const chaqueVote = p.rythmes?.textes_votes === "immediat" || (!!seul && !!process.env.ALERTES_TEXTES_ESSAI_VOTES);
    const depuisCoche = p.rythmes?.textes_votes_depuis || null;
    const profilPro = niveau === "pro" && p.alertes_textes !== false;
    if (!chaqueVote && !profilPro) continue;
    const loc = await resolveLocation(p.city || null, p.department || null);
    const sesElus = suivis.filter((s: any) => s.user_id === p.user_id);
    const sesPartis = p.consentement_suivis ? partisSuivis.filter((s: any) => s.user_id === p.user_id && GROUPES_PARTIS[s.ref]) : [];
    const { count: dejaAujourdhui } = await supabase.from("user_notifications").select("id", { count: "exact", head: true })
      .eq("user_id", p.user_id).eq("categorie", "textes").gte("created_at", aujourdhui);
    let reste = MAX_PAR_JOUR - (dejaAujourdhui || 0);
    const candidats = [...new Set([...(chaqueVote ? votes : []), ...(profilPro ? utiles : [])])]
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
    for (const t of candidats) {
      const demande = chaqueVote && t.source === "scrutin_final" && (!depuisCoche || String(t.analyse_le || maintenant) >= depuisCoche);
      let pourquoi = profilPro && t.importance != null ? raisons(t, p, { ...loc, regionCode: loc.regionCode ?? regionOfDept(loc.deptCode) }) : [];
      // Vote : la position de chaque élu suivi (en fonction), et celle du groupe de chaque parti suivi.
      const elus: { nom: string; position: string }[] = [];
      const partis: any[] = [];
      if (t.source === "scrutin_final") {
        const parId = nominatifs.get(t.source_id) || new Map();
        for (const s of sesElus) {
          const e: any = t.chambre === "AN" ? (s.deputy_id ? deputes.get(s.deputy_id) : null) : (s.senator_id ? senateurs.get(s.senator_id) : null);
          if (!e || e.sitting === false) continue;
          elus.push({ nom: `${e.first_name} ${e.last_name}`, position: parId.get(String(e.an_id || e.senate_matricule || "").toUpperCase()) || "absent" });
        }
        for (const s of sesPartis) {
          const g = GROUPES_PARTIS[s.ref];
          const groupe = t.chambre === "AN" ? g.an && { nom: g.an.nom, code: g.an.po } : g.senat && { nom: g.senat.nom, code: g.senat.code };
          if (!groupe) { partis.push({ nom: s.label, groupe: null }); continue; }
          const r = (t.resultat?.groupes || []).find((x: any) => x.code === groupe.code);
          partis.push({ nom: s.label, groupe: groupe.nom, ...positionGroupe(r?.pour, r?.contre, r?.abstention) });
        }
        if (!demande && elus.some(e => e.position !== "absent") && !pourquoi.length) pourquoi = ["un élu que vous suivez a pris part au vote"];
      }
      if (!demande) {
        if (!pourquoi.length || reste <= 0) continue;
        reste--;
      }
      lignes.push({
        user_id: p.user_id, type: "texte", categorie: "textes", importance: t.importance ?? 3,
        title: t.titre.slice(0, 300), detail: t.explication, url: t.url, event_at: t.date_texte,
        domain: t.chambre === "AN" ? "Assemblée nationale" : t.chambre === "SENAT" ? "Sénat" : "Journal officiel",
        scrutin_id: t.source === "scrutin_final" ? t.scrutinId : null,
        donnees: { source: t.source, chambre: t.chambre, intitule: t.intitule, date_vote: t.date_texte, resultat: t.resultat, pourquoi, elus, partis, extrait: t.extrait },
        created_at: maintenant, read: false, dedup_key: `texte|${t.source}|${t.source_id}`,
      });
    }
  }
  console.log(`[Textes] ${lignes.length} alerte(s) pour ${new Set(lignes.map(l => l.user_id)).size} membre(s).`);
  if (DRY) { for (const l of lignes.slice(0, 20)) console.log(`   → ${l.user_id.slice(0, 8)} : ${l.title.slice(0, 60)} | ${l.donnees.resultat?.adopte ? "adopté" : l.donnees.resultat ? "rejeté" : ""} | élus ${JSON.stringify(l.donnees.elus)} | partis ${JSON.stringify(l.donnees.partis)} (${l.donnees.pourquoi.join(" ; ")})`); return; }
  for (let i = 0; i < lignes.length; i += 300) {
    const { error } = await supabase.from("user_notifications").upsert(lignes.slice(i, i + 300), { onConflict: "user_id,dedup_key", ignoreDuplicates: true });
    if (error) throw error;
  }
}

if (process.argv[1] && process.argv[1].endsWith("alertes-textes.ts")) {
  main().then(() => { process.exitCode = 0; }).catch(e => { console.error(e); process.exitCode = 1; });
}
