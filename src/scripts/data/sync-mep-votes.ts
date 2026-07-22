import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Historique de votes des eurodéputés français — source HowTheyVote.eu (votes nominaux du
// Parlement européen, open data). Chaque scrutin détaille la position de chaque député par
// son id officiel du PE : liaison directe, aucun rapprochement flou.
//
// On ne retient que les votes PRINCIPAUX (is_main : vote final sur un texte), pour éviter de
// noyer l'utilisateur sous les votes d'amendements — même logique que pour les scrutins AN.
const API = "https://howtheyvote.eu/api";
const HT = "https://howtheyvote.eu";
// Fenêtre : les N votes principaux les plus récents (garde-fou volume au premier passage).
const MAX_VOTES = Number(process.env.MEP_VOTES_MAX || 250);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getJson(url: string, tries = 4): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "LaPolitiqueBot/1.0", "Accept": "application/json" }, signal: AbortSignal.timeout(45000) });
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

export async function syncMepVotes() {
  console.log("--- SYNC VOTES EURODÉPUTÉS (HowTheyVote) ---");

  // On restreint aux id EP de nos eurodéputés français (81).
  const { data: meps, error } = await supabase.from("meps").select("id");
  if (error) throw error;
  const frenchIds = new Set((meps ?? []).map((m: any) => String(m.id)));
  console.log(`> ${frenchIds.size} eurodéputés français en base.`);

  // 1) Liste des votes principaux récents.
  const mainVotes: any[] = [];
  for (let page = 1; mainVotes.length < MAX_VOTES && page <= 60; page++) {
    const data = await getJson(`${API}/votes?page=${page}&page_size=50`);
    const results = data?.results ?? [];
    for (const v of results) if (v.is_main) mainVotes.push(v);
    if (!data?.has_next) break;
    await sleep(200);
  }
  const votes = mainVotes.slice(0, MAX_VOTES);
  console.log(`> ${votes.length} votes principaux à traiter.`);

  // 2) Pour chaque vote, positions des députés français.
  const rows: any[] = [];
  let done = 0;
  for (const v of votes) {
    const detail = await getJson(`${API}/votes/${v.id}`).catch(() => null);
    const mv = detail?.member_votes ?? [];
    const result = detail?.result || v.result || null;
    for (const m of mv) {
      const id = String(m?.member?.id ?? "");
      if (!frenchIds.has(id)) continue;
      rows.push({
        mep_id: id,
        vote_id: String(v.id),
        title: (v.display_title || detail?.display_title || "").slice(0, 400),
        reference: v.reference || null,
        voted_at: v.timestamp || null,
        position: m.position || null,           // FOR | AGAINST | ABSTENTION | DID_NOT_VOTE
        result,
        url: `${HT}/votes/${v.id}`,
        updated_at: new Date().toISOString(),
      });
    }
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${votes.length} votes…`);
    await sleep(150);
  }
  console.log(`> ${rows.length} positions (français) à enregistrer.`);

  for (let i = 0; i < rows.length; i += 500) {
    const { error: upErr } = await supabase.from("mep_votes").upsert(rows.slice(i, i + 500), { onConflict: "mep_id,vote_id" });
    if (upErr) { console.error("[MepVotes] upsert:", upErr.message); throw upErr; }
  }
  console.log(`--- TERMINE. ${rows.length} positions enregistrées. ---`);
  return rows.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-mep-votes.ts")) {
  syncMepVotes().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
