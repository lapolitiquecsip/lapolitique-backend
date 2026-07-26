import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Taux de présence des sénateurs, calculé depuis les scrutins publics du Sénat.
// Pour chaque sénateur (matricule = voter_official_id) : participation = positions
// exprimées (for/against/abstain) sur le nombre de scrutins où il/elle figure.
// non_voting = « n'a pas pris part au vote » (compté comme non-participation).
// Exceptions institutionnelles : le·la Président·e du Sénat préside les séances et ne prend
// pas part aux votes par convention — son « taux de présence aux votes » n'a pas de sens et
// l'épingler serait trompeur. On laisse sa participation à NULL (pas de bloc comparatif).
// Gérard Larcher (matricule 86034E), Président du Sénat.
const EXCLUDED_MATRICULES = new Set(["86034E"]);

async function main() {
  console.log("--- PRÉSENCE AUX VOTES DES SÉNATEURS ---");

  // 1) Agrégation par matricule sur les votes des scrutins SENAT (jointure inner).
  const stats = new Map<string, { part: number; total: number }>();
  let page = 0;
  for (let from = 0; ; from += 1000, page++) {
    const { data, error } = await supabase
      .from("legislative_votes")
      .select("voter_official_id, position, legislative_scrutins!inner(chamber)")
      .eq("legislative_scrutins.chamber", "SENAT")
      .range(from, from + 999);
    if (error) throw error;
    for (const r of (data as any[])) {
      const m = r.voter_official_id;
      if (!m) continue;
      const s = stats.get(m) || { part: 0, total: 0 };
      s.total++;
      if (r.position && r.position !== "non_voting") s.part++;
      stats.set(m, s);
    }
    if (page % 20 === 0) process.stdout.write(`\r  lu ${from + (data as any[]).length} votes…`);
    if (!data || data.length < 1000) break;
  }
  console.log(`\n> ${stats.size} sénateurs distincts dans les scrutins.`);

  // 2) Mise à jour des sénateurs par matricule.
  const { data: senators, error: sErr } = await supabase.from("senators").select("id, senate_matricule, last_name");
  if (sErr) throw sErr;
  let updated = 0, missing = 0;
  const now = new Date().toISOString();
  for (const sen of senators || []) {
    if (sen.senate_matricule && EXCLUDED_MATRICULES.has(sen.senate_matricule)) {
      await supabase.from("senators").update({ participation_rate: null, votes_participated: null, votes_total: null, activity_updated_at: now }).eq("id", sen.id);
      continue;
    }
    const s = sen.senate_matricule ? stats.get(sen.senate_matricule) : null;
    if (!s || s.total === 0) { missing++; continue; }
    const rate = Math.round((s.part / s.total) * 1000) / 10;
    await supabase.from("senators").update({
      participation_rate: rate, votes_participated: s.part, votes_total: s.total, activity_updated_at: now,
    }).eq("id", sen.id);
    updated++;
  }
  console.log(`--- TERMINE. ${updated} sénateurs mis à jour, ${missing} sans données de vote. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
