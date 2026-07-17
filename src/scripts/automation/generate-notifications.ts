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

export async function generateNotifications() {
  console.log("--- GÉNÉRATION DES NOTIFICATIONS (votes des députés suivis) ---");

  // 1. Qui suit qui (côté députés).
  const follows = await fetchAll("user_follows", "user_id, deputy_id", q => q.not("deputy_id", "is", null));
  if (follows.length === 0) { console.log("> Aucun suivi de député."); return 0; }
  const deputyIds = [...new Set(follows.map(f => f.deputy_id))];
  console.log(`> ${follows.length} suivis, ${deputyIds.length} députés distincts.`);

  // 2. Résoudre deputy_id (uuid) → an_id (clé des votes) + nom.
  const deputies = await fetchAll("deputies", "id, an_id, first_name, last_name", q => q.in("id", deputyIds));
  const byId = new Map(deputies.map(d => [d.id, d]));
  const anIds = deputies.map(d => d.an_id).filter(Boolean);

  // 3. Votes récents de ces députés.
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const votes: any[] = [];
  for (let i = 0; i < anIds.length; i += 50) {
    const batch = anIds.slice(i, i + 50);
    const rows = await fetchAll("deputy_votes", "deputy_an_id, scrutin_id, position, date_scrutin, created_at",
      q => q.in("deputy_an_id", batch).gte("created_at", since));
    votes.push(...rows);
  }
  console.log(`> ${votes.length} votes récents (${LOOKBACK_DAYS} j).`);
  if (votes.length === 0) return 0;

  // 4. Récupérer l'objet des scrutins concernés et ne garder que les votes solennels.
  const scrutinIds = [...new Set(votes.map(v => v.scrutin_id))];
  const scrutins = new Map<string, any>();
  for (let i = 0; i < scrutinIds.length; i += 200) {
    const batch = scrutinIds.slice(i, i + 200);
    const rows = await fetchAll("scrutins", "id, objet, title, date_scrutin", q => q.in("id", batch));
    for (const s of rows) scrutins.set(s.id, s);
  }

  const anByDeputy = new Map(deputies.map(d => [d.an_id, d]));
  const followersByDeputyId = new Map<string, string[]>();
  for (const f of follows) {
    const arr = followersByDeputyId.get(f.deputy_id) || [];
    arr.push(f.user_id);
    followersByDeputyId.set(f.deputy_id, arr);
  }

  // 5. Construire les notifications (un vote solennel → une notif par abonné).
  const rows: any[] = [];
  const now = new Date().toISOString();
  let skippedNoise = 0;
  for (const v of votes) {
    const scrutin = scrutins.get(v.scrutin_id);
    const objet = (scrutin?.objet || scrutin?.title || "").trim();
    if (!objet || !DECISIVE.test(objet)) { skippedNoise++; continue; }

    const dep = anByDeputy.get(v.deputy_an_id);
    if (!dep) continue;
    const users = followersByDeputyId.get(dep.id) || [];
    const pos = String(v.position || "").toUpperCase();
    const eventAt = scrutin?.date_scrutin || v.date_scrutin || v.created_at || null;

    for (const userId of users) {
      rows.push({
        user_id: userId,
        type: "vote",
        deputy_id: dep.id,
        scrutin_id: v.scrutin_id,
        title: objet.slice(0, 300),
        detail: `${dep.first_name} ${dep.last_name} a voté ${pos}`.trim(),
        position: pos,
        event_at: eventAt,
        created_at: now,
        dedup_key: `vote|${v.scrutin_id}|${dep.id}`,
      });
    }
  }
  console.log(`> ${rows.length} notifications candidates (${skippedNoise} votes non solennels ignorés).`);
  if (rows.length === 0) return 0;

  // 6. Upsert idempotent : (user_id, dedup_key) est unique → pas de doublon au re-run.
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error, count } = await supabase
      .from("user_notifications")
      .upsert(rows.slice(i, i + 500), { onConflict: "user_id,dedup_key", ignoreDuplicates: true, count: "exact" });
    if (error) { console.error("[Notifications] upsert:", error.message); throw error; }
    inserted += count ?? 0;
  }
  console.log(`--- TERMINE. ${inserted} nouvelle(s) notification(s). ---`);
  return inserted;
}

if (process.argv[1] && process.argv[1].endsWith("generate-notifications.ts")) {
  generateNotifications().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
