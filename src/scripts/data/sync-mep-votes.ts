import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Votes + assiduité des eurodéputés français — HowTheyVote.eu.
// Approche PAR MEMBRE : l'endpoint /members/{id}/votes renvoie TOUS les scrutins nominaux
// de la mandature avec la position du député (y compris DID_NOT_VOTE). Cela permet à la fois
// d'enregistrer l'historique complet ET de calculer un taux de participation réel.
//
// Précision honnête : ce taux mesure la PARTICIPATION AUX VOTES NOMINAUX, pas la présence
// physique en séance ou en commission (le vote peut être exprimé pour le groupe). C'est la
// métrique fiable et vérifiable dont on dispose ; le front l'affiche avec ce libellé exact.
const API = "https://howtheyvote.eu/api";
const HT = "https://howtheyvote.eu";

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
      await sleep(1200 * (i + 1));
    }
  }
}

export async function syncMepVotes() {
  console.log("--- SYNC VOTES + ASSIDUITÉ EURODÉPUTÉS (HowTheyVote) ---");
  const { data: meps, error } = await supabase.from("meps").select("id, full_name");
  if (error) throw error;
  console.log(`> ${meps?.length ?? 0} eurodéputés.`);

  let totalRows = 0;
  for (const m of meps || []) {
    const votes: any[] = [];
    for (let page = 1; ; page++) {
      const data = await getJson(`${API}/members/${m.id}/votes?page=${page}&page_size=100`).catch(() => null);
      const results = data?.results ?? [];
      votes.push(...results);
      if (!data?.has_next || page > 60) break;
      await sleep(80);
    }
    if (votes.length === 0) { console.warn(`  ! ${m.full_name} : aucun vote.`); continue; }

    // Assiduité : proportion de scrutins où une position a été exprimée.
    const participated = votes.filter(v => v.position && v.position !== "DID_NOT_VOTE").length;
    const rate = Math.round((participated / votes.length) * 1000) / 10;

    // On stocke TOUS les scrutins (avec le drapeau is_main pour le tri côté fiche).
    const rows = votes.map(v => ({
      mep_id: String(m.id),
      vote_id: String(v.id),
      title: (v.display_title || "").slice(0, 400),
      reference: v.reference || null,
      voted_at: v.timestamp || null,
      position: v.position || null,
      result: v.result || null,
      is_main: !!v.is_main,
      url: `${HT}/votes/${v.id}`,
      updated_at: new Date().toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: upErr } = await supabase.from("mep_votes").upsert(rows.slice(i, i + 500), { onConflict: "mep_id,vote_id" });
      if (upErr) { console.error(`  ! ${m.full_name} upsert:`, upErr.message); break; }
    }
    await supabase.from("meps").update({
      votes_total: votes.length,
      votes_participated: participated,
      attendance_rate: rate,
      votes_synced_at: new Date().toISOString(),
    }).eq("id", m.id);

    totalRows += rows.length;
    console.log(`  ✓ ${m.full_name} : ${votes.length} votes, participation ${rate}%`);
    await sleep(120);
  }
  console.log(`--- TERMINE. ${totalRows} lignes de votes. ---`);
  return totalRows;
}

if (process.argv[1] && process.argv[1].endsWith("sync-mep-votes.ts")) {
  syncMepVotes().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
