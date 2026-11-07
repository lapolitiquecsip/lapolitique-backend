import "dotenv/config";
import fs from "fs";
import AdmZip from "adm-zip";
import { supabase } from "../../config/supabase.js";

/**
 * Questions des députés au Gouvernement (Pro) : questions écrites (QE) et questions au
 * Gouvernement en séance (QG), avec la réponse du ministre quand elle est publiée.
 * Source : open data de l'Assemblée (un JSON par question, mis à jour chaque nuit).
 * Table questions_parlement, indexée pour la recherche ; seules les questions nouvelles ou dont
 * l'état a changé (réponse publiée, retrait…) sont réécrites. Aucune IA.
 *   --dry        n'écrit rien, affiche le volume
 *   --fichier=QE.zip,QG.zip  archives déjà téléchargées
 */
const DRY = process.argv.includes("--dry");
const SOURCES = {
  QE: "https://data.assemblee-nationale.fr/static/openData/repository/17/questions/questions_ecrites/Questions_ecrites.json.zip",
  QG: "https://data.assemblee-nationale.fr/static/openData/repository/17/questions/questions_gouvernement/Questions_gouvernement.json.zip",
};
const texteBrut = (s: unknown) => String(s ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/ /g, " ").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
const liste = <T,>(x: T | T[] | null | undefined): T[] => (Array.isArray(x) ? x : x ? [x] : []);

type Question = {
  uid: string; type: string; numero: string; rubrique: string | null; objet: string | null; acteur_ref: string | null; groupe: string | null;
  ministere: string | null; date_question: string | null; texte_question: string | null; date_reponse: string | null; texte_reponse: string | null; statut: string; url: string;
};

export function lireQuestion(j: any): Question | null {
  const q = j?.question; if (!q?.uid) return null;
  const tq = liste(q.textesQuestion?.texteQuestion)[0];
  const tr = liste(q.textesReponse?.texteReponse).slice(-1)[0];
  const cloture = q.cloture?.libelleCloture || q.cloture?.codeCloture || null;
  const dateQ = tq?.infoJO?.dateJO || liste(q.minAttribs?.minAttrib)[0]?.infoJO?.dateJO || null;
  return {
    uid: q.uid, type: q.type, numero: String(q.identifiant?.numero ?? ""),
    rubrique: q.indexationAN?.rubrique ?? null, objet: liste(q.indexationAN?.analyses?.analyse).join(" ; ") || null,
    acteur_ref: q.auteur?.identite?.acteurRef ?? null, groupe: q.auteur?.groupe?.abrege ?? null,
    ministere: q.minInt?.developpe ?? q.minInt?.abrege ?? null,
    date_question: dateQ, texte_question: tq ? texteBrut(tq.texte) : null,
    date_reponse: tr?.infoJO?.dateJO ?? null, texte_reponse: tr ? texteBrut(tr.texte).slice(0, 60000) : null,
    statut: tr ? "repondue" : cloture ? `close : ${cloture}` : "en attente",
    url: `https://questions.assemblee-nationale.fr/q17/17-${q.identifiant?.numero}${q.type}.htm`,
  };
}

async function archive(type: "QE" | "QG", local?: string): Promise<AdmZip> {
  if (local) return new AdmZip(fs.readFileSync(local));
  // Le serveur de l'Assemblée coupe parfois la connexion en plein téléchargement (« other side
  // closed ») : le job échouait une nuit sur deux. Quatre essais espacés avant d'abandonner.
  let derniere: unknown;
  for (let essai = 1; essai <= 4; essai++) {
    try {
      const r = await fetch(SOURCES[type], { signal: AbortSignal.timeout(15 * 60000) });
      if (!r.ok) throw new Error(`${type} : HTTP ${r.status}`);
      return new AdmZip(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      derniere = e;
      console.log(`::warning::${type} : téléchargement interrompu (essai ${essai}/4) — ${(e as Error).message}`);
      await new Promise(res => setTimeout(res, essai * 20000));
    }
  }
  throw derniere;
}

async function main() {
  const locaux = process.argv.find(a => a.startsWith("--fichier="))?.split("=").slice(1).join("=").split(",");
  const connues = new Map<string, string>();
  if (!DRY) for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from("questions_parlement").select("uid, statut, date_reponse").range(de, de + 999);
    if (error) throw error;
    for (const q of data || []) connues.set(q.uid, `${q.statut}|${q.date_reponse}`);
    if (!data || data.length < 1000) break;
  }
  const aEcrire: Question[] = []; let total = 0, octets = 0;
  for (const [i, type] of (["QE", "QG"] as const).entries()) {
    const zip = await archive(type, locaux?.[i]);
    for (const e of zip.getEntries()) {
      if (!e.entryName.endsWith(".json")) continue;
      const q = lireQuestion(JSON.parse(e.getData().toString("utf8")));
      if (!q) continue;
      total++; octets += (q.texte_question?.length || 0) + (q.texte_reponse?.length || 0);
      if (connues.get(q.uid) !== `${q.statut}|${q.date_reponse}`) aEcrire.push(q);
    }
  }
  console.log(`[Questions AN] ${total} question(s), ${(octets / 1e6).toFixed(1)} Mo de texte, ${aEcrire.length} nouvelle(s) ou modifiée(s)${DRY ? " — ESSAI" : ""}.`);
  if (DRY) { for (const q of aEcrire.slice(0, 3)) console.log(" ", q.uid, q.groupe, q.ministere, q.statut, "|", q.objet, "|", q.texte_question?.slice(0, 100)); return; }
  for (let i = 0; i < aEcrire.length; i += 500) {
    const { error } = await supabase.from("questions_parlement").upsert(aEcrire.slice(i, i + 500).map(q => ({ ...q, maj_le: new Date().toISOString() })), { onConflict: "uid" });
    if (error) throw error;
  }
  console.log(`[Questions AN] ${aEcrire.length} question(s) écrite(s).`);
}

if (process.argv[1]?.endsWith("sync-questions-an.ts")) main().catch(e => { console.error(e); process.exitCode = 1; });
