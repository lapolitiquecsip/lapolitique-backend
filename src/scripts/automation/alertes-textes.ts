import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { fetchAll, resolveLocation } from "./generate-interest-notifications.js";
import { regionOfDept } from "../../lib/dept-region.js";

/**
 * Alertes Pro « un texte vous concerne ».
 *
 * Une alerte ne part que pour un TEXTE : vote final d'une loi à l'Assemblée ou au
 * Sénat (« sur l'ensemble »), loi ou décret publié au Journal officiel — et
 * seulement si ce texte peut concerner le membre d'après son profil.
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
const MAX_PAR_JOUR = 4;
const SITE_URL = process.env.SITE_URL || "https://lapolitiquecestsimple.fr";
const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’'`«»"]/g, "'").replace(/\s+/g, " ").trim();

// Actes sans portée pour le public : jamais analysés.
const ROUTINE = /\b(nominations?|nomm[ée]e?s?|titularisation|admission|cessation de fonctions|fin de fonctions|d[ée]l[ée]gation de signature|promotion|r[ée]int[ée]gration|d[ée]tachement|radiation|naturalisation|changement de nom|composition (du|de la) (conseil|commission|comit[ée])|attribution de la m[ée]daille|l[ée]gion d.honneur|ordre national du m[ée]rite)\b/i;

export const PUBLICS = ["tous", "contribuables", "salaries", "fonctionnaires", "independants", "chefs_entreprise", "agriculteurs", "demandeurs_emploi", "retraites", "etudiants", "jeunes", "seniors", "parents", "locataires", "proprietaires", "automobilistes"];
export const SECTEURS = ["sante", "education", "agriculture", "btp_logement", "commerce_artisanat", "industrie", "transport", "numerique", "culture_medias", "securite_defense", "justice", "social", "energie_environnement", "tourisme_restauration", "finance_assurance", "fonction_publique"];
const DOMAINES = ["economie", "emploi", "retraites", "sante", "education", "ecologie", "agriculture", "securite", "immigration", "europe", "social", "logement", "institutions", "transports", "numerique", "culture"];

type Texte = { source: string; source_id: string; chambre: string; titre: string; resume: string; url: string; date: string; resultat?: any; scrutinId?: string };

/* ─────────────── 1. Textes nouveaux ─────────────── */

async function textesRecents(): Promise<Texte[]> {
  const depuis = new Date(Date.now() - JOURS * 86400000).toISOString();
  const out: Texte[] = [];

  // Votes finaux (« sur l'ensemble »), avec le résumé du dossier et les résultats par groupe.
  const scrutins = await fetchAll("legislative_scrutins", "id, official_id, dossier_id, chamber, title, result_label, for_count, against_count, abstain_count, voted_at, source_url, explanation",
    q => q.gte("voted_at", depuis).ilike("title", "%ensemble%"));
  const dossiers = [...new Set(scrutins.map((s: any) => s.dossier_id).filter(Boolean))];
  const resumes = new Map<string, string>();
  if (dossiers.length) {
    const { data } = await supabase.from("legislative_analyses").select("dossier_id, summary, audience").in("dossier_id", dossiers);
    for (const a of data || []) if (!resumes.has(a.dossier_id) || a.audience === "citizen") resumes.set(a.dossier_id, typeof a.summary === "string" ? a.summary : JSON.stringify(a.summary));
  }
  // Les résultats par groupe ne portent que le code de l'organe (PO845401…) : le nom vient des partis.
  const { data: partis } = await supabase.from("political_parties").select("abbrev, name, datan_group_id").not("datan_group_id", "is", null);
  const nomGroupe = new Map((partis || []).map((p: any) => [p.datan_group_id, p.abbrev === "NI" ? "Non-inscrits" : `${p.abbrev}`]));
  for (const s of scrutins) {
    const { data: groupes } = await supabase.from("legislative_group_results").select("group_code, group_name, for_count, against_count, abstain_count").eq("scrutin_id", s.id);
    out.push({
      source: "scrutin_final", source_id: String(s.id), chambre: s.chamber, scrutinId: String(s.id),
      titre: s.title.replace(/^(sur )?l'ensemble (du |de la |des )?/i, "").replace(/^./, (c: string) => c.toUpperCase()),
      resume: [s.explanation, resumes.get(s.dossier_id)].filter(Boolean).join("\n\n").slice(0, 6000),
      url: s.dossier_id ? `${SITE_URL}/lois/?dossier=${s.dossier_id}` : s.source_url, date: s.voted_at,
      resultat: { adopte: /adopt/i.test(s.result_label || ""), libelle: s.result_label, pour: s.for_count, contre: s.against_count, abstention: s.abstain_count,
        groupes: (groupes || []).filter((g: any) => (g.for_count + g.against_count + g.abstain_count) > 0)
          .map((g: any) => ({ code: g.group_code, nom: g.group_name || nomGroupe.get(g.group_code) || "Autre", pour: g.for_count, contre: g.against_count, abstention: g.abstain_count }))
          .sort((a: any, b: any) => (b.pour + b.contre + b.abstention) - (a.pour + a.contre + a.abstention)) },
    });
  }

  // Journal officiel : lois et décrets qui ne sont pas des actes de routine.
  const decrets = await fetchAll("decrees", "jorf_id, title, display_title, summary, source_url, date_publi, nature",
    q => q.gte("date_publi", depuis.slice(0, 10)));
  for (const d of decrets) {
    if (ROUTINE.test(`${d.title || ""} ${d.display_title || ""}`) || !d.summary) continue;
    out.push({ source: /loi/i.test(d.nature || "") ? "loi" : "decret", source_id: d.jorf_id, chambre: "JO", titre: d.display_title || d.title,
      resume: `${d.title}\n\n${d.summary}`, url: d.source_url, date: d.date_publi });
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
  const communs = t.publics.filter((x: string) => publicsDuMembre(p).includes(x) && x !== "contribuables");
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

  const analyses: any[] = [];
  for (const t of textes) {
    let a = connus.get(`${t.source}|${t.source_id}`);
    if (!a) {
      const r = await analyser(t).catch(e => { console.warn(`  ! ${t.titre.slice(0, 60)} : ${e.message}`); return null; });
      if (!r) continue;
      a = { source: t.source, source_id: t.source_id, chambre: t.chambre, titre: t.titre.slice(0, 400), resume: t.resume.slice(0, 2000), url: t.url, date_texte: t.date, resultat: t.resultat ?? null, ...r };
      if (!DRY) await supabase.from("textes_impacts").upsert(a, { onConflict: "source,source_id" });
      console.log(`  · [${a.importance}] ${a.titre.slice(0, 70)} → ${a.publics.join(",")} | ${a.secteurs.join(",")}${a.explication ? "" : " (explication non prouvée, retirée)"}`);
    }
    a.scrutinId = t.scrutinId;
    analyses.push(a);
  }
  const utiles = analyses.filter(a => a.importance >= 3);
  if (!utiles.length) { console.log("[Textes] Aucun texte d'importance suffisante."); return; }

  // Membres Pro avec alertes textes activées.
  const pros = (await fetchAll("profiles", "id", q => q.eq("subscription_tier", "pro"))).map((p: any) => p.id);
  // Essai : ALERTES_TEXTES_SEUL=<id> → ce seul compte (même non Pro), personne d'autre.
  const seul = process.env.ALERTES_TEXTES_SEUL;
  const ids = seul ? [seul] : pros;
  const prefs = await fetchAll("user_preferences", "user_id, profession, age_range, logement, enfants, secteur, interests, city, department, alertes_textes", q => q.in("user_id", ids));
  const suivis = await fetchAll("user_follows", "user_id, deputy_id, senator_id", q => q.in("user_id", ids));
  const deputes = new Map((await fetchAll("deputies", "id, an_id, first_name, last_name", q => q)).map((d: any) => [d.id, d]));
  const senateurs = new Map((await fetchAll("senators", "id, senate_matricule, first_name, last_name", q => q)).map((d: any) => [d.id, d]));
  const aujourdhui = new Date().toISOString().slice(0, 10);

  const lignes: any[] = [];
  for (const p of prefs) {
    if (p.alertes_textes === false) continue;
    const loc = await resolveLocation(p.city || null, p.department || null);
    const sesElus = suivis.filter((s: any) => s.user_id === p.user_id);
    const { count: dejaAujourdhui } = await supabase.from("user_notifications").select("id", { count: "exact", head: true })
      .eq("user_id", p.user_id).eq("categorie", "textes").gte("created_at", aujourdhui);
    let reste = MAX_PAR_JOUR - (dejaAujourdhui || 0);
    for (const t of [...utiles].sort((a, b) => b.importance - a.importance)) {
      if (reste <= 0) break;
      let pourquoi = raisons(t, p, { ...loc, regionCode: loc.regionCode ?? regionOfDept(loc.deptCode) });
      // Vote final : la position des élus suivis par le membre.
      let elus: { nom: string; position: string }[] = [];
      if (t.source === "scrutin_final" && sesElus.length) {
        const { data: votes } = await supabase.from("legislative_votes").select("voter_official_id, voter_name, position").eq("scrutin_id", t.scrutinId);
        const parId = new Map((votes || []).map((v: any) => [String(v.voter_official_id).toUpperCase(), v]));
        for (const s of sesElus) {
          const e: any = s.deputy_id ? deputes.get(s.deputy_id) : s.senator_id ? senateurs.get(s.senator_id) : null;
          const v = e && parId.get(String(e.an_id || e.senate_matricule || "").toUpperCase());
          if (v) elus.push({ nom: `${e.first_name} ${e.last_name}`, position: v.position });
        }
        if (elus.length && !pourquoi.length) pourquoi = ["un élu que vous suivez a pris part au vote"];
      }
      if (!pourquoi.length) continue;
      reste--;
      lignes.push({
        user_id: p.user_id, type: "texte", categorie: "textes", importance: t.importance,
        title: t.titre.slice(0, 300), detail: t.explication, url: t.url, event_at: t.date_texte,
        domain: t.chambre === "AN" ? "Assemblée nationale" : t.chambre === "SENAT" ? "Sénat" : "Journal officiel",
        donnees: { source: t.source, chambre: t.chambre, resultat: t.resultat, pourquoi, elus, extrait: t.extrait },
        created_at: new Date().toISOString(), read: false, dedup_key: `texte|${t.source}|${t.source_id}`,
      });
    }
  }
  console.log(`[Textes] ${lignes.length} alerte(s) pour ${new Set(lignes.map(l => l.user_id)).size} membre(s).`);
  if (DRY) { for (const l of lignes.slice(0, 10)) console.log(`   → ${l.user_id.slice(0, 8)} : ${l.title.slice(0, 60)} (${l.donnees.pourquoi.join(" ; ")})`); return; }
  for (let i = 0; i < lignes.length; i += 300) {
    const { error } = await supabase.from("user_notifications").upsert(lignes.slice(i, i + 300), { onConflict: "user_id,dedup_key", ignoreDuplicates: true });
    if (error) throw error;
  }
}

if (process.argv[1] && process.argv[1].endsWith("alertes-textes.ts")) {
  main().then(() => { process.exitCode = 0; }).catch(e => { console.error(e); process.exitCode = 1; });
}
