import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Résultats de vote PAR GROUPE au Parlement européen, à partir des données OFFICIELLES
// (HowTheyVote /votes/{id} → stats.by_group). Pour chaque scrutin référencé dans mep_votes,
// on enregistre, par groupe : pour / contre / abstention / n'a pas voté + la position
// majoritaire. 100 % factuel, automatisé (ne (re)traite que les votes manquants).
const API = "https://howtheyvote.eu/api";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getJson(url: string, tries = 4): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "LaPolitiqueBot/1.0", "Accept": "application/json" }, signal: AbortSignal.timeout(45000) });
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await sleep(1200 * (i + 1)); }
  }
}

// Position majoritaire d'un groupe = la position exprimée la plus fréquente (hors « n'a pas voté »).
function majority(s: any): string {
  const opts: Array<[string, number]> = [["FOR", s.FOR || 0], ["AGAINST", s.AGAINST || 0], ["ABSTENTION", s.ABSTENTION || 0]];
  opts.sort((a, b) => b[1] - a[1]);
  return opts[0][1] === 0 ? "DID_NOT_VOTE" : opts[0][0];
}

async function main() {
  const force = process.argv.includes("--force");
  console.log("--- RÉSULTATS DE VOTE PAR GROUPE (PE) ---");

  const seen = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("mep_votes").select("vote_id, is_main").eq("is_main", true).range(from, from + 999);
    if (error) throw error;
    for (const r of (data as any[])) seen.add(r.vote_id);
    if (!data || data.length < 1000) break;
  }
  const done = new Set<string>();
  if (!force) {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("vote_group_results").select("vote_id").range(from, from + 999);
      for (const r of (data as any[]) || []) done.add(r.vote_id);
      if (!data || data.length < 1000) break;
    }
  }
  const todo = [...seen].filter(id => !done.has(id));
  console.log(`> ${seen.size} votes principaux, ${todo.length} à traiter.`);

  let ok = 0;
  for (const id of todo) {
    try {
      const v = await getJson(`${API}/votes/${id}`).catch(() => null);
      const by = v?.stats?.by_group;
      if (!Array.isArray(by) || by.length === 0) { await sleep(120); continue; }
      const groups = by.map((g: any) => {
        const s = g.stats || {};
        return {
          code: g.group?.short_label || g.group?.code || "?",
          label: g.group?.label || g.group?.code || "",
          for: s.FOR || 0, against: s.AGAINST || 0, abstention: s.ABSTENTION || 0, dnv: s.DID_NOT_VOTE || 0,
          position: majority(s),
        };
      }).sort((a: any, b: any) => (b.for + b.against + b.abstention) - (a.for + a.against + a.abstention));
      await supabase.from("vote_group_results").upsert({ vote_id: id, groups, updated_at: new Date().toISOString() }, { onConflict: "vote_id" });
      ok++;
      if (ok % 50 === 0) console.log(`  … ${ok}/${todo.length}`);
      await sleep(120);
    } catch (e: any) { console.warn(`  ! ${id}: ${e.message}`); }
  }
  console.log(`--- TERMINE. ${ok} scrutins avec résultats par groupe. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
