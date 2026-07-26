import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Génère les notifications « un élu suivi a voté ».
//
// Périmètre assumé de ce lot :
//   - DÉPUTÉS uniquement. Les votes de l'Assemblée sont reliables (deputies.an_id →
//     deputy_votes.deputy_an_id). Côté Sénat, aucune table ne relie un sénateur à ses
//     votes de façon fiable — on ne fabrique donc rien pour eux plutôt que du faux.
//   - VOTES SOLENNELS seulement. ~90 % des scrutins sont des amendements : notifier chacun
//     noierait l'utilisateur. On ne retient que les votes qui tranchent un texte.
//
// Idempotent : `dedup_key` = user|scrutin|deputy, avec un UNIQUE (user_id, dedup_key) en base.
// Relancer le job ne crée pas de doublon.

// Fenêtre : on ne notifie que les scrutins récents, pour éviter de déverser tout l'historique
// dans le fil au premier passage.
const LOOKBACK_DAYS = Number(process.env.NOTIF_LOOKBACK_DAYS || 30);

// Votes décisifs : même logique que l'évaluation du programme. Les amendements et articles
// sont du bruit procédural pour une notification.
const DECISIVE = /^\s*(l'ensemble|la motion|la déclaration|la declaration|la proposition de loi|le projet de loi|la proposition de résolution|la proposition de resolution)/i;

async function fetchAll(table: string, select: string, apply: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await apply(supabase.from(table).select(select)).range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Position brute (AN / PE / Sénat) → libellé homogène affiché à l'utilisateur.
const POS_LABEL = (p: string): string => {
  const s = String(p || "").toUpperCase();
  if (s === "FOR" || s === "POUR") return "POUR";
  if (s === "AGAINST" || s === "CONTRE") return "CONTRE";
  if (s === "ABSTAIN" || s === "ABSTENTION") return "ABSTENTION";
  return s;
};
// Positions qui ne déclenchent pas de notification (non-participation).
const IS_NONVOTE = (p: string) => /^(did_not_vote|non_voting|absent|non votant)$/i.test(String(p || ""));

// --- EURODÉPUTÉS : votes principaux récents des eurodéputés suivis (mep_votes). -----------
async function mepRows(since: string, now: string): Promise<any[]> {
  const follows = await fetchAll("user_follows", "user_id, mep_id", q => q.not("mep_id", "is", null));
  if (follows.length === 0) return [];
  const mepIds = [...new Set(follows.map(f => f.mep_id))];
  const meps = await fetchAll("meps", "id, first_name, last_name", q => q.in("id", mepIds));
  const nameById = new Map(meps.map(m => [m.id, `${m.first_name} ${m.last_name}`.trim()]));
  const followersByMep = new Map<string, string[]>();
  for (const f of follows) { const a = followersByMep.get(f.mep_id) || []; a.push(f.user_id); followersByMep.set(f.mep_id, a); }

  const rows: any[] = [];
  for (let i = 0; i < mepIds.length; i += 40) {
    const batch = mepIds.slice(i, i + 40);
    const votes = await fetchAll("mep_votes", "mep_id, vote_id, title, position, voted_at",
      q => q.in("mep_id", batch).eq("is_main", true).gte("voted_at", since));
    for (const v of votes) {
      if (IS_NONVOTE(v.position)) continue;
      const name = nameById.get(v.mep_id); if (!name) continue;
      const pos = POS_LABEL(v.position);
      for (const userId of followersByMep.get(v.mep_id) || []) {
        rows.push({
          user_id: userId, type: "vote", mep_id: v.mep_id, scrutin_id: String(v.vote_id),
          title: (v.title || "Vote au Parlement européen").slice(0, 300),
          detail: `${name} a voté ${pos} au Parlement européen`, position: pos,
          event_at: v.voted_at || null, created_at: now, dedup_key: `vote|mep|${v.vote_id}|${v.mep_id}`,
        });
      }
    }
  }
  console.log(`> Eurodéputés : ${follows.length} suivis → ${rows.length} notifs candidates.`);
  return rows;
}

// --- SÉNATEURS : scrutins publics récents du Sénat des sénateurs suivis. ------------------
async function senatorRows(since: string, now: string): Promise<any[]> {
  const follows = await fetchAll("user_follows", "user_id, senator_id", q => q.not("senator_id", "is", null));
  if (follows.length === 0) return [];
  const senIds = [...new Set(follows.map(f => f.senator_id))];
  const senators = await fetchAll("senators", "id, senate_matricule, first_name, last_name", q => q.in("id", senIds));
  const byMatricule = new Map(senators.filter(s => s.senate_matricule).map(s => [s.senate_matricule, s]));
  const followersBySen = new Map<string, string[]>();
  for (const f of follows) { const a = followersBySen.get(f.senator_id) || []; a.push(f.user_id); followersBySen.set(f.senator_id, a); }

  // Scrutins SENAT récents (id interne → titre + date).
  const scrutins = await fetchAll("legislative_scrutins", "id, official_id, title, voted_at",
    q => q.eq("chamber", "SENAT").gte("voted_at", since));
  if (scrutins.length === 0) { console.log("> Sénateurs : aucun scrutin récent."); return []; }
  const scrutinById = new Map(scrutins.map(s => [s.id, s]));
  const scrutinIds = scrutins.map(s => s.id);

  const rows: any[] = [];
  const matricules = [...byMatricule.keys()];
  for (let i = 0; i < scrutinIds.length; i += 100) {
    const sBatch = scrutinIds.slice(i, i + 100);
    const votes = await fetchAll("legislative_votes", "scrutin_id, voter_official_id, position",
      q => q.in("scrutin_id", sBatch).in("voter_official_id", matricules));
    for (const v of votes) {
      if (IS_NONVOTE(v.position)) continue;
      const sen = byMatricule.get(v.voter_official_id); if (!sen) continue;
      const scr = scrutinById.get(v.scrutin_id); if (!scr) continue;
      const pos = POS_LABEL(v.position);
      const name = `${sen.first_name} ${sen.last_name}`.trim();
      for (const userId of followersBySen.get(sen.id) || []) {
        rows.push({
          user_id: userId, type: "vote", senator_id: sen.id, scrutin_id: String(scr.official_id || scr.id),
          title: (scr.title || "Scrutin au Sénat").slice(0, 300),
          detail: `${name} a voté ${pos} au Sénat`, position: pos,
          event_at: scr.voted_at || null, created_at: now, dedup_key: `vote|sen|${scr.id}|${sen.id}`,
        });
      }
    }
  }
  console.log(`> Sénateurs : ${follows.length} suivis → ${rows.length} notifs candidates.`);
  return rows;
}

export async function generateNotifications() {
  console.log("--- GÉNÉRATION DES NOTIFICATIONS (votes des élus suivis) ---");
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const now = new Date().toISOString();
  const allRows: any[] = [];

  // 1. Qui suit qui (côté députés).
  const follows = await fetchAll("user_follows", "user_id, deputy_id", q => q.not("deputy_id", "is", null));
  const deputyIds = [...new Set(follows.map(f => f.deputy_id))];
  console.log(`> Députés : ${follows.length} suivis, ${deputyIds.length} distincts.`);

  // 2. Députés → votes solennels récents (uniquement s'il y a des suivis de députés).
  if (deputyIds.length > 0) {
    const deputies = await fetchAll("deputies", "id, an_id, first_name, last_name", q => q.in("id", deputyIds));
    const anIds = deputies.map(d => d.an_id).filter(Boolean);
    const votes: any[] = [];
    for (let i = 0; i < anIds.length; i += 50) {
      const batch = anIds.slice(i, i + 50);
      const rows = await fetchAll("deputy_votes", "deputy_an_id, scrutin_id, position, date_scrutin, created_at",
        q => q.in("deputy_an_id", batch).gte("created_at", since));
      votes.push(...rows);
    }
    if (votes.length > 0) {
      const scrutinIds = [...new Set(votes.map(v => v.scrutin_id))];
      const scrutins = new Map<string, any>();
      for (let i = 0; i < scrutinIds.length; i += 200) {
        const rows = await fetchAll("scrutins", "id, objet, title, date_scrutin", q => q.in("id", scrutinIds.slice(i, i + 200)));
        for (const s of rows) scrutins.set(s.id, s);
      }
      const anByDeputy = new Map(deputies.map(d => [d.an_id, d]));
      const followersByDeputyId = new Map<string, string[]>();
      for (const f of follows) { const a = followersByDeputyId.get(f.deputy_id) || []; a.push(f.user_id); followersByDeputyId.set(f.deputy_id, a); }
      let skippedNoise = 0;
      for (const v of votes) {
        const scrutin = scrutins.get(v.scrutin_id);
        const objet = (scrutin?.objet || scrutin?.title || "").trim();
        if (!objet || !DECISIVE.test(objet)) { skippedNoise++; continue; }
        const dep = anByDeputy.get(v.deputy_an_id); if (!dep) continue;
        const pos = POS_LABEL(v.position);
        const eventAt = scrutin?.date_scrutin || v.date_scrutin || v.created_at || null;
        for (const userId of followersByDeputyId.get(dep.id) || []) {
          allRows.push({
            user_id: userId, type: "vote", deputy_id: dep.id, scrutin_id: v.scrutin_id,
            title: objet.slice(0, 300), detail: `${dep.first_name} ${dep.last_name} a voté ${pos}`.trim(),
            position: pos, event_at: eventAt, created_at: now, dedup_key: `vote|${v.scrutin_id}|${dep.id}`,
          });
        }
      }
      console.log(`> Députés : ${allRows.length} notifs candidates (${skippedNoise} non solennels ignorés).`);
    }
  }

  // 3. Eurodéputés + sénateurs suivis.
  allRows.push(...await mepRows(since, now));
  allRows.push(...await senatorRows(since, now));

  if (allRows.length === 0) { console.log("--- TERMINE. Aucune notification. ---"); return 0; }

  // 4. Upsert idempotent : (user_id, dedup_key) est unique → pas de doublon au re-run.
  let inserted = 0;
  for (let i = 0; i < allRows.length; i += 500) {
    const { error, count } = await supabase
      .from("user_notifications")
      .upsert(allRows.slice(i, i + 500), { onConflict: "user_id,dedup_key", ignoreDuplicates: true, count: "exact" });
    if (error) { console.error("[Notifications] upsert:", error.message); throw error; }
    inserted += count ?? 0;
  }
  console.log(`--- TERMINE. ${inserted} nouvelle(s) notification(s). ---`);
  return inserted;
}

if (process.argv[1] && process.argv[1].endsWith("generate-notifications.ts")) {
  generateNotifications().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
