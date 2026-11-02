import "dotenv/config";
import { parse } from "csv-parse/sync";
import { supabase } from "../../config/supabase.js";
import { fetchAll } from "../automation/generate-interest-notifications.js";

/**
 * Application des lois : les mesures réglementaires attendues par chaque loi, et les décrets parus.
 *
 * Source : le baromètre de l'application des lois de l'Assemblée nationale (LexImpact, à partir de
 * l'échéancier de Légifrance), licence ouverte. Deux fichiers : une ligne par loi, une par mesure.
 *
 * Le baromètre ne date pas la parution d'un décret : applique_vu_le est le jour où on le voit paru.
 * L'échéance est la date de publication annoncée par l'observation (« Publication envisagée en mars
 * 2027 » → fin mars), sinon la colonne « Date prévue », qui est celle de l'entrée en vigueur.
 * Une publication « éventuelle » n'est jamais comptée en retard.
 *
 * Échoue si le format change ou si le fichier est anormalement court : mieux vaut une alarme qu'une
 * base vidée. Prévient aussi si le fichier cesse d'avancer alors que de nouvelles lois paraissent.
 *   --sec   n'écrit rien
 */
const SEC = process.argv.includes("--sec");
const SOURCE = "https://barometre.assemblee-nationale.fr";
const SECOURS: Record<string, string> = {
  barometre_application_lois_assemblee: "https://www.data.gouv.fr/api/1/datasets/r/35ca58b9-d02b-48c8-bc92-10c59abdbe9c",
  barometre_application_mesures_assemblee: "https://www.data.gouv.fr/api/1/datasets/r/e1938c3f-7a0c-46a6-8b1e-58109d7e6999",
};
const MOIS: Record<string, number> = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
const ETATS: Record<string, string> = { "appliqué": "applique", "en attente d'application": "attente", "sans objet": "sans_objet" };

const sansAccent = (t: string) => (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Une date réelle, ou rien : le baromètre contient des saisies impossibles (« 29/02/2022 »). */
const iso = (a: number, m: number, j: number) => {
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j ? d.toISOString().slice(0, 10) : null;
};
const finDeMois = (a: number, m: number) => iso(a, m, new Date(Date.UTC(a, m, 0)).getUTCDate());

/** La date d'une colonne « 01/10/2027 » ou « 01/10/27 » ; le reste (un intitulé de décret…) ne vaut rien. */
function dateCourte(t: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec((t || "").trim());
  if (!m) return null;
  const a = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
  return iso(a, Number(m[2]), Number(m[1]));
}

const RANGS: Record<string, number> = { premier: 1, deuxieme: 2, second: 2, troisieme: 3, quatrieme: 4 };
const NOMS_MOIS = "janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre";
const FORMES: [RegExp, (m: RegExpExecArray) => string | null][] = [
  [/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/, m => iso(Number(m[3]), Number(m[2]), Number(m[1]))],
  [new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${NOMS_MOIS})\\s+(\\d{4})\\b`), m => iso(Number(m[3]), MOIS[m[2]], Number(m[1]))],
  [new RegExp(`\\b(${NOMS_MOIS})\\s+(\\d{4})\\b`), m => finDeMois(Number(m[2]), MOIS[m[1]])],
  [/\b([1-4])(?:er|e|eme|nd)?\s+trimestre\s+(\d{4})\b/, m => finDeMois(Number(m[2]), Number(m[1]) * 3)],
  [/\b([12])(?:er|e|eme|nd)?\s+semestre\s+(\d{4})\b/, m => finDeMois(Number(m[2]), Number(m[1]) * 6)],
  [/\b(premier|deuxieme|second|troisieme|quatrieme)\s+trimestre\s+(\d{4})\b/, m => finDeMois(Number(m[2]), RANGS[m[1]] * 3)],
  [/\b(premier|deuxieme|second)\s+semestre\s+(\d{4})\b/, m => finDeMois(Number(m[2]), RANGS[m[1]] * 6)],
];
/** Une année seule ne vaut date qu'à la suite de « publication » : ailleurs, ce peut être n'importe quoi. */
const FORMES_ANNEE: [RegExp, (m: RegExpExecArray) => string | null][] = [
  [/\b(?:fin(?:\s+de\s+l'annee)?|en|courant)\s+(20\d{2})\b/, m => finDeMois(Number(m[1]), 12)],
  [/\bdebut\s+(20\d{2})\b/, m => finDeMois(Number(m[1]), 3)],
  [/\bprintemps\s+(20\d{2})\b/, m => finDeMois(Number(m[1]), 6)],
  [/\bete\s+(20\d{2})\b/, m => finDeMois(Number(m[1]), 9)],
  [/\bautomne\s+(20\d{2})\b/, m => finDeMois(Number(m[1]), 12)],
];

/** La première date citée dans un bout de texte. */
function premiereDate(t: string, formes: typeof FORMES): string | null {
  let meilleure: { position: number; date: string | null } | null = null;
  for (const [forme, lire] of formes) {
    const m = forme.exec(t);
    if (m && (!meilleure || m.index < meilleure.position)) meilleure = { position: m.index, date: lire(m) };
  }
  return meilleure?.date ?? null;
}

/**
 * L'échéance annoncée par une observation. La date de la phrase « Publication envisagée… » prime :
 * « Entrée en vigueur différée au 1er septembre 2026. Publication envisagée en novembre 2026 » attend
 * novembre, et non septembre. Faute de quoi, la première date citée (une entrée en vigueur, le plus souvent).
 * Une observation qui cite un texte (« Arrêté du 20 octobre 2026 ») n'annonce rien : le texte existe déjà.
 */
export function echeanceDe(observation: string): string | null {
  const t = sansAccent(observation).trim();
  const phrases = t.match(/publication[^.;]*/g) || [];
  for (const phrase of [...phrases.filter(p => p.includes("envisag")), ...phrases]) {
    const date = premiereDate(phrase, [...FORMES, ...FORMES_ANNEE]);
    if (date) return date;
  }
  return premiereDate(t, FORMES);
}

const citeUnTexte = (observation: string) => /^(arrete|decret|ordonnance|circulaire)\b/.test(sansAccent(observation).trim());

async function lire(nom: string): Promise<Record<string, string>[]> {
  let texte: string | null = null;
  for (const url of [`${SOURCE}/${nom}.csv`, SECOURS[nom]]) {
    // Le délai couvre aussi la lecture du corps : un serveur qui s'arrête en route passe au secours.
    const r = await fetch(url, { signal: AbortSignal.timeout(180_000) }).catch(() => null);
    texte = r?.ok ? await r.text().catch(() => null) : null;
    if (texte) break;
    console.log(`::warning::${url} : ${r?.ok ? "lecture interrompue" : `HTTP ${r?.status ?? "réseau"}`}`);
  }
  if (!texte) throw new Error(`${nom} : source injoignable`);
  return parse(texte, { columns: h => h.map((c: string) => sansAccent(c).trim()), delimiter: ";", bom: true, relax_quotes: true, relax_column_count: true, skip_empty_lines: true });
}
const champ = (r: Record<string, string>, nom: string) => {
  if (!(nom in r)) throw new Error(`Colonne absente du baromètre : ${nom}`);
  return (r[nom] || "").trim();
};
const oui = (v: string) => v.toLowerCase() === "oui";

async function main() {
  const [lois, mesures] = await Promise.all([lire("barometre_application_lois_assemblee"), lire("barometre_application_mesures_assemblee")]);
  console.log(`[Application] ${lois.length} lois, ${mesures.length} mesures.`);
  if (lois.length < 1500 || mesures.length < 10000) throw new Error("Baromètre anormalement court : rien n'est écrit.");

  const aujourdhui = new Date().toISOString().slice(0, 10);
  const lignesMesures = mesures.map(m => {
    const etatBrut = champ(m, "etat");
    const etat = ETATS[etatBrut];
    if (!etat) throw new Error(`État inconnu : ${etatBrut}`);
    const observation = champ(m, "objectif initial de publication, observations");
    const delai = Number(champ(m, "delai d'application (en jours)"));
    return {
      loi_jorf_id: champ(m, "identifiant loi"), ordre: Number(champ(m, "n° ordre")),
      articles: champ(m, "articles") || null, base_legale: champ(m, "base legale") || null, objet: champ(m, "objet") || null, observation: observation || null,
      decret_id: champ(m, "identifiant decret") || null,
      echeance: citeUnTexte(observation) ? null : echeanceDe(observation) || dateCourte(champ(m, "date prevue")),
      eventuelle: /eventuel/.test(sansAccent(observation)),
      etat, delai_jours: Number.isFinite(delai) && champ(m, "delai d'application (en jours)") !== "" ? Math.round(delai) : null,
    };
  }).filter(m => m.loi_jorf_id && Number.isInteger(m.ordre));

  const parLoi = new Map<string, typeof lignesMesures>();
  for (const m of lignesMesures) parLoi.set(m.loi_jorf_id, [...(parLoi.get(m.loi_jorf_id) || []), m]);
  const enRetard = (m: (typeof lignesMesures)[0]) => m.etat === "attente" && !m.eventuelle && !!m.echeance && m.echeance < aujourdhui;

  const maintenant = new Date().toISOString();
  const lignesLois = lois.map(l => {
    const jorf = champ(l, "identifiant legifrance de la loi");
    const ms = parLoi.get(jorf) || [];
    return {
      jorf_id: jorf, titre: champ(l, "titre de la loi"), publiee_le: champ(l, "date de publication de la loi") || null,
      dossier_legifrance: champ(l, "identifiant legifrance du dossier legislatif") || null, dossier_an: champ(l, "identifiant assemblee du dossier legislatif") || null,
      dossier_senat: champ(l, "identifiant senat du dossier legislatif") || null, commission: champ(l, "libelle de la commission de l'assemblee saisie au fond") || null,
      legislature: Number(champ(l, "legislature")) || null, gouvernement: champ(l, "gouvernement") || null,
      sans_echeancier: oui(champ(l, "loi sans echeancier")), application_directe: oui(champ(l, "loi d'application directe")),
      nb_mesures: ms.filter(m => m.etat !== "sans_objet").length, nb_appliquees: ms.filter(m => m.etat === "applique").length,
      nb_attente: ms.filter(m => m.etat === "attente").length, nb_retard: ms.filter(enRetard).length, maj_le: maintenant,
    };
  }).filter(l => l.jorf_id);
  const connues = new Set(lignesLois.map(l => l.jorf_id));
  const orphelines = lignesMesures.filter(m => !connues.has(m.loi_jorf_id));
  if (orphelines.length) console.log(`::warning::${orphelines.length} mesure(s) d'une loi absente du fichier des lois, écartée(s).`);

  // Le fichier des lois doit suivre le Journal officiel.
  const derniereSource = lignesLois.map(l => l.publiee_le || "").sort().pop() || "";
  const { data: jo } = await supabase.from("promulgated_laws").select("promulgated_at").order("promulgated_at", { ascending: false }).limit(1);
  const dernierJo = String(jo?.[0]?.promulgated_at || "").slice(0, 10);
  if (dernierJo && derniereSource && Date.parse(dernierJo) - Date.parse(derniereSource) > 21 * 864e5) {
    console.log(`::warning::Baromètre en retard : dernière loi ${derniereSource}, Journal officiel ${dernierJo}.`);
    process.exitCode = 1;
  }

  const avant = new Map<string, any>();
  for (const a of await fetchAll("application_mesures", "loi_jorf_id, ordre, etat, objet, vu_le, applique_vu_le", q => q)) avant.set(`${a.loi_jorf_id}|${a.ordre}`, a);
  const aEcrire = lignesMesures.filter(m => connues.has(m.loi_jorf_id)).map(m => {
    const c = avant.get(`${m.loi_jorf_id}|${m.ordre}`);
    // Seul le passage de « en attente » à « appliqué » date une parution : l'historique ne déclenche aucune alerte.
    const appliqueLe = m.etat !== "applique" ? null : c?.applique_vu_le ?? (c?.etat === "attente" && c.objet === m.objet ? maintenant : null);
    return { ...m, vu_le: c?.vu_le ?? maintenant, applique_vu_le: appliqueLe, maj_le: maintenant };
  });
  const passages = aEcrire.filter(m => m.applique_vu_le === maintenant).length;
  const retards = lignesLois.reduce((t, l) => t + l.nb_retard, 0);
  console.log(`[Application] ${lignesLois.length} lois, ${aEcrire.length} mesures, ${retards} en retard, ${passages} décret(s) nouvellement paru(s).`);
  if (SEC) {
    const rec = lignesLois.filter(l => (l.publiee_le || "") >= "2024-07-18");
    console.log(`[Application] 17e législature : ${rec.length} lois, ${rec.reduce((t, l) => t + l.nb_mesures, 0)} mesures, ${rec.reduce((t, l) => t + l.nb_appliquees, 0)} appliquées, ${rec.reduce((t, l) => t + l.nb_attente, 0)} en attente, ${rec.reduce((t, l) => t + l.nb_retard, 0)} en retard.`);
    const att = aEcrire.filter(m => m.etat === "attente");
    console.log(`[Application] en attente : ${att.length}, avec échéance ${att.filter(m => m.echeance).length}, éventuelles ${att.filter(m => m.eventuelle).length}.`);
    for (const m of att.filter(enRetard).slice(-5)) console.log(`  retard ${m.echeance} · ${(m.objet || "").slice(0, 60)} · ${(m.observation || "").slice(0, 45)}`);
    return;
  }

  for (let i = 0; i < lignesLois.length; i += 500) {
    const { error } = await supabase.from("application_lois").upsert(lignesLois.slice(i, i + 500), { onConflict: "jorf_id" });
    if (error) throw error;
  }
  for (let i = 0; i < aEcrire.length; i += 500) {
    const { error } = await supabase.from("application_mesures").upsert(aEcrire.slice(i, i + 500), { onConflict: "loi_jorf_id,ordre" });
    if (error) throw error;
  }
  // Une mesure retirée de l'échéancier n'attend plus rien.
  const presentes = new Set(aEcrire.map(m => `${m.loi_jorf_id}|${m.ordre}`));
  let retirees = 0;
  for (const [cle, a] of avant) {
    if (presentes.has(cle)) continue;
    const { error } = await supabase.from("application_mesures").delete().eq("loi_jorf_id", a.loi_jorf_id).eq("ordre", a.ordre);
    if (error) console.log(`  ! ${cle} : ${error.message}`); else retirees++;
  }
  console.log(`[Application] Terminé${retirees ? `, ${retirees} mesure(s) retirée(s)` : ""}.`);
}

if (process.argv[1] && process.argv[1].endsWith("sync-application-lois.ts")) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
