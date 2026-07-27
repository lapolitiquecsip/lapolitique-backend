import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { legislativeTitleMatchScore } from "../../lib/legislative/normalization.js";

// Pour chaque vote solennel « sur l'ensemble » d'un texte à l'Assemblée, on relie le scrutin à
// son dossier parlementaire (par ressemblance de titre, scoring durci) et on en déduit l'ÉTAPE
// SUIVANTE à partir de l'état RÉEL du dossier (source officielle) : transmis au Sénat, adopté
// définitivement, etc. Aucune invention : sans lien fiable, on n'écrit rien pour ce scrutin.
const MIN_SCORE = 0.75;
const REJECTED = /n['’]a pas adopt/i;

type Dossier = { id: string; official_id: string; title: string; current_chamber: string | null; status_code: string | null; status_label: string | null };

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
      .select("id, official_id, title, current_chamber, status_code, status_label").range(from, from + 999);
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
    let top: { d: Dossier; score: number } | null = null;
    for (const d of dossiers) {
      const score = legislativeTitleMatchScore(d.title, needle);
      if (score < MIN_SCORE) continue;
      if (!top || score > top.score) top = { d, score };
    }
    if (!top) { unmatched++; continue; }        // pas de lien fiable → rien (pas d'invention)
    const nav = navetteFrom(top.d);
    rows.push({ scrutin_id: s.id, dossier_id: top.d.id, match_score: top.score, navette_status: nav.status, navette_label: nav.label, updated_at: new Date().toISOString() });
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
