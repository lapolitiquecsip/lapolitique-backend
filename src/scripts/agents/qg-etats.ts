import "dotenv/config";
import { supabase } from "../../config/supabase.js";

/**
 * L'état de chaque agent dans l'organigramme du QG (24/11/2026), toutes les 30 minutes.
 *
 * Pour chaque agent dont la `source` est une tâche GitHub (« github:<front|back>:<fichier.yml> »),
 * lit ses 5 derniers passages terminés : vert si le dernier a réussi, orange s'il a réussi mais
 * qu'au moins deux des cinq derniers ont échoué, rouge si le dernier a échoué. Les agents de cycle
 * prennent l'état de Cyrille (agents-cycles.yml), qui les réveille. Gratuit, sans IA.
 *
 * Le registre (prénoms, rôles, portraits) est rempli depuis le tableau de bord local :
 * node qg-organigramme.mjs (dossier lpcs-tableau-de-bord).
 */
const DEPOTS: Record<string, string> = { front: "lapolitiquecsip/politique-pour-tous", back: "lapolitiquecsip/lapolitique-backend" };
const JETON = process.env.GITHUB_TOKEN;

type Etat = { dernier_passage: string; dernier_etat: "ok" | "attention" | "panne"; dernier_message: string | null };

async function etat(depot: string, fichier: string): Promise<Etat | null> {
  const r = await fetch(`https://api.github.com/repos/${DEPOTS[depot]}/actions/workflows/${encodeURIComponent(fichier)}/runs?per_page=6&exclude_pull_requests=true`, {
    headers: { Accept: "application/vnd.github+json", ...(JETON ? { Authorization: `Bearer ${JETON}` } : {}) },
  });
  if (!r.ok) return null;
  const runs = ((await r.json()).workflow_runs || []).filter((x: any) => x.status === "completed").slice(0, 5);
  if (!runs.length) return null;
  const d = runs[0];
  const echecs = runs.filter((x: any) => x.conclusion === "failure").length;
  const e: Etat["dernier_etat"] = d.conclusion === "success" ? (echecs >= 2 ? "attention" : "ok") : d.conclusion === "failure" ? "panne" : "attention";
  const message = e === "ok" ? null
    : d.conclusion === "failure" ? `Dernier passage en échec${echecs > 1 ? ` (${echecs} sur les ${runs.length} derniers)` : ""}`
    : d.conclusion === "success" ? `${echecs} échecs sur les ${runs.length} derniers passages`
    : `Dernier passage : ${d.conclusion}`;
  return { dernier_passage: d.updated_at, dernier_etat: e, dernier_message: message };
}

async function main() {
  const { data: agents, error } = await supabase.from("qg_agents").select("id, source, dernier_etat").like("source", "github:%");
  if (error) throw error;
  let n = 0, pannes = 0, cyrille: Etat | null = null;
  for (const a of agents ?? []) {
    const [, depot, fichier] = String(a.source).split(":");
    const e = await etat(depot, fichier);
    if (!e) continue;
    if (fichier === "agents-cycles.yml") cyrille = e;
    if (e.dernier_etat === "panne") pannes++;
    await supabase.from("qg_agents").update(e).eq("id", a.id);
    // Une panne qui commence (et seulement à ce moment) laisse une trace dans le fil du QG.
    if (e.dernier_etat === "panne" && a.dernier_etat !== "panne") {
      await supabase.from("qg_activite").insert({ agent: a.id, equipe: "production", genre: "panne", message: `En panne : ${e.dernier_message}` });
    }
    n++;
  }
  if (cyrille) {
    await supabase.from("qg_agents").update({ dernier_passage: cyrille.dernier_passage, dernier_etat: cyrille.dernier_etat === "panne" ? "attention" : cyrille.dernier_etat })
      .like("source", "cycle:%");
  }
  console.log(`[QG] ${n} agents relevés, ${pannes} en panne.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
