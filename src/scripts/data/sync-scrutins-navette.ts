import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { legislativeTitleMatchScore } from "../../lib/legislative/normalization.js";

// Pour chaque vote solennel « sur l'ensemble » d'un texte à l'Assemblée, on relie le scrutin à
// son dossier parlementaire (par ressemblance de titre, scoring durci) et on en déduit l'ÉTAPE
// SUIVANTE à partir de l'état RÉEL du dossier (source officielle) : transmis au Sénat, adopté
// définitivement, etc. Aucune invention : sans lien fiable, on n'écrit rien pour ce scrutin.
//
// Une même loi a deux dossiers, un par chambre (DLR… à l'Assemblée, SENAT:ppl… au Sénat),
// aux titres quasi identiques. Retenir le premier venu donnait des contradictions : la loi
// médico-sociale promulguée le 21/10/2026 restait « désormais au Sénat » parce que le vote
// avait été rattaché au dossier du Sénat, figé en mai. On examine donc tous les dossiers à
// égalité de titre, plus les dossiers frères (companion_dossier_id), et l'on retient l'étape
// la plus avancée — à condition qu'elle soit datée du vote ou après : une étape antérieure
// (« adopté par le Sénat » en mai) ne dit rien de ce qui a suivi le vote d'octobre. Pour une
// promulgation, la date qui fait foi est celle du Journal officiel (promulgated_laws).
const MIN_SCORE = 0.75;
const EGALITE = 0.05;
const RANG: Record<string, number> = { assemblee: 0, senat: 1, cc: 2, definitif: 3 };
const REJECTED = /n['’]a pas adopt/i;

type Dossier = { id: string; official_id: string; title: string; current_chamber: string | null; status_code: string | null; status_label: string | null; latest_step_at: string | null; companion_dossier_id: string | null };

function cleanScrutinTitle(t: string): string {
  return (t || "").replace(/^l['’]ensemble\s+(de la|du|des|de l['’])\s*/i, "").trim();
}

function navetteFrom(d: Dossier): { status: string; label: string } {
  const sl = (d.status_label || "").toLowerCase();
  const promulgated = d.status_code === "promulgated" || /promul/.test(sl);
  if (promulgated) return { status: "definitif", label: "Adoptée définitivement · devenue loi" };
  if (/adopt[ée]e?\s+d[ée]finitivement/.test(sl)) return { status: "definitif", label: "Adoptée définitivement" };
  if (d.current_chamber === "SENAT" || /s[ée]nat|transmis/.test(sl)) return { status: "senat", label: "Adoptée par l'Assemblée · désormais au Sénat" };
  if (d.current_chamber === "CC" || /conseil constitutionnel/.test(sl)) return { status: "cc", label: "Adoptée · examen au Conseil constitutionnel" };
  return { status: "assemblee", label: "Adoptée par l'Assemblée" };
}

async function loadDossiers(): Promise<Dossier[]> {
  const out: Dossier[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("legislative_dossiers")
      .select("id, official_id, title, current_chamber, status_code, status_label, latest_step_at, companion_dossier_id").range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...(data as Dossier[]));
    if (data.length < 1000) break;
  }
  return out;
}

export async function syncScrutinsNavette() {
  console.log("--- SYNC ÉTAPE NAVETTE DES SCRUTINS AN ---");
  const dossiers = await loadDossiers();
  console.log(`> ${dossiers.length} dossiers en mémoire.`);
  const parId = new Map(dossiers.map(d => [d.id, d]));
  const { data: lois, error: loisErr } = await supabase.from("promulgated_laws").select("dossier_id, promulgated_at");
  if (loisErr) throw loisErr;
  const promulgueeLe = new Map<string, string>();
  for (const l of lois || []) if (l.dossier_id && l.promulgated_at) promulgueeLe.set(l.dossier_id, l.promulgated_at);
  const freres = new Map<string, Dossier[]>();
  for (const d of dossiers) {
    const c = d.companion_dossier_id && parId.get(d.companion_dossier_id);
    if (!c) continue;
    freres.set(d.id, [...(freres.get(d.id) || []), c]);
    freres.set(c.id, [...(freres.get(c.id) || []), d]);
  }

  // Votes solennels « sur l'ensemble » d'un texte (on exclut articles, amendements, motions
  // de procédure). On couvre large et on garde les plus récents.
  const { data: scrutins, error } = await supabase.from("scrutins")
    .select("id, title, resultat, date_scrutin")
    .eq("type", "LOI")
    .ilike("title", "l'ensemble%")
    .order("date_scrutin", { ascending: false })
    .limit(400);
  if (error) throw error;
  console.log(`> ${scrutins?.length ?? 0} scrutins « sur l'ensemble » à traiter.`);

  const rows: any[] = [];
  let linked = 0, rejected = 0, unmatched = 0;
  for (const s of scrutins ?? []) {
    if (REJECTED.test(s.resultat || "")) {
      rows.push({ scrutin_id: s.id, dossier_id: null, match_score: null, navette_status: "rejet", navette_label: "Rejeté par l'Assemblée", updated_at: new Date().toISOString() });
      rejected++; continue;
    }
    const needle = cleanScrutinTitle(s.title);
    const notes = dossiers
      .map(d => ({ d, score: legislativeTitleMatchScore(d.title, needle) }))
      .filter(x => x.score >= MIN_SCORE);
    if (!notes.length) { unmatched++; continue; }   // pas de lien fiable → rien (pas d'invention)
    const meilleur = Math.max(...notes.map(x => x.score));
    const candidats = new Map<string, { d: Dossier; score: number }>();
    for (const x of notes.filter(x => x.score >= meilleur - EGALITE)) {
      candidats.set(x.d.id, x);
      for (const f of freres.get(x.d.id) || []) if (!candidats.has(f.id)) candidats.set(f.id, { d: f, score: x.score });
    }
    // Une étape compte si elle date du jour du vote ou d'après (marge d'un jour : les dates
    // d'étape sont en UTC, la veille au soir pour un vote parisien du matin).
    const seuil = Date.parse(s.date_scrutin) - 864e5;
    let retenu: { d: Dossier; score: number; nav: { status: string; label: string } } | null = null;
    for (const x of candidats.values()) {
      const jo = promulgueeLe.get(x.d.id);
      const date = jo || x.d.latest_step_at;
      if (!date || Date.parse(date) < seuil) continue;
      const nav = jo ? { status: "definitif", label: "Adoptée définitivement · devenue loi" } : navetteFrom(x.d);
      if (!retenu || RANG[nav.status] > RANG[retenu.nav.status]) retenu = { ...x, nav };
    }
    const lien = retenu || { ...notes.find(x => x.score === meilleur)!, nav: { status: "assemblee", label: "Adoptée par l'Assemblée" } };
    rows.push({ scrutin_id: s.id, dossier_id: lien.d.id, match_score: lien.score, navette_status: lien.nav.status, navette_label: lien.nav.label, updated_at: new Date().toISOString() });
    linked++;
  }

  if (rows.length) {
    const { error: upErr } = await supabase.from("scrutin_navette").upsert(rows, { onConflict: "scrutin_id" });
    if (upErr) { console.error("[navette] upsert:", upErr.message); throw upErr; }
  }
  console.log(`--- TERMINE. ${linked} liés, ${rejected} rejetés, ${unmatched} sans lien (non écrits). ---`);
  return rows.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-scrutins-navette.ts")) {
  syncScrutinsNavette().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
