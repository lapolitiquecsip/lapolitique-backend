import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Envoie par e-mail les notifications « un élu suivi a voté » non encore envoyées.
// S'appuie sur l'infra existante : generate-notifications remplit user_notifications ;
// ici on regroupe par utilisateur, on respecte l'e-mail + la préférence `suivi_depute`
// (dans subscribers), on envoie UN digest, puis on marque `emailed_at` (idempotent).
//
// Provider : Resend (offre gratuite ~3000 mails/mois). Variables d'env requises :
//   RESEND_API_KEY   (secret)
//   EMAIL_FROM       ex. "La Politique C'est Simple <alertes@ton-domaine.fr>" (expéditeur vérifié)
//   SITE_URL         ex. "https://lapolitiquecsip.github.io/politique-pour-tous" (liens)
// Dry-run si RESEND_API_KEY absente : log seulement, n'écrit rien.

const SITE_URL = process.env.SITE_URL || "https://lapolitiquecsip.github.io/politique-pour-tous";
const FROM = process.env.EMAIL_FROM || "La Politique C'est Simple <onboarding@resend.dev>";
const RESEND_KEY = process.env.RESEND_API_KEY;
const LOOKBACK_DAYS = Number(process.env.EMAIL_LOOKBACK_DAYS || 7);

const esc = (s: string) => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const posColor = (p: string) => (p === "POUR" ? "#059669" : p === "CONTRE" ? "#e11d48" : p === "ABSTENTION" ? "#d97706" : "#64748b");

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_KEY) { console.log(`[DRY] → ${to} : ${subject}`); return true; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) { console.error(`[EMAIL] échec ${to} : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); return false; }
  return true;
}

function buildHtml(displayName: string, items: any[]): string {
  const rows = items.map(n => `
    <tr><td style="padding:12px 0;border-bottom:1px solid #eef2f7">
      <div style="font-weight:700;color:#0f172a;font-size:15px">${esc(n.detail || "")}</div>
      <div style="color:#475569;font-size:13px;margin-top:2px">${esc(n.title || "")}</div>
      <span style="display:inline-block;margin-top:6px;font-size:11px;font-weight:800;letter-spacing:.06em;color:${posColor(n.position)}">VOTE : ${esc(n.position || "")}</span>
    </td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;padding:24px">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:28px">
        <h1 style="font-size:18px;color:#0f172a;margin:0 0 4px">Vos élus suivis ont voté</h1>
        <p style="color:#64748b;font-size:13px;margin:0 0 16px">${esc(displayName ? "Bonjour " + displayName + "," : "Bonjour,")} voici les derniers votes solennels des élus que vous suivez.</p>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
        <a href="${SITE_URL}/dashboard" style="display:inline-block;margin-top:20px;background:#0f172a;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 18px;border-radius:10px">Voir mon tableau de bord</a>
        <p style="color:#94a3b8;font-size:11px;margin-top:20px">Vous recevez cet e-mail car vous suivez des élus sur La Politique C'est Simple. Gérez vos alertes depuis votre profil.</p>
      </div>
    </div></body></html>`;
}

async function main() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  // Notifications non envoyées, récentes.
  const { data: notifs, error } = await supabase
    .from("user_notifications")
    .select("id, user_id, title, detail, position, event_at, created_at")
    .is("emailed_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) {
    // Colonne pas encore ajoutée → on sort proprement (migration à appliquer), pas d'échec du cron.
    if (/emailed_at|column .* does not exist/i.test(error.message)) {
      console.log("[EMAIL] Colonne user_notifications.emailed_at absente — appliquer la migration. Étape ignorée.");
      return;
    }
    throw error;
  }
  if (!notifs?.length) { console.log("Aucune notification à envoyer."); return; }

  // Regroupe par utilisateur.
  const byUser = new Map<string, any[]>();
  for (const n of notifs) { const a = byUser.get(n.user_id) || []; a.push(n); byUser.set(n.user_id, a); }

  // Coordonnées + préférences des abonnés concernés.
  const userIds = [...byUser.keys()];
  const { data: subs } = await supabase.from("subscribers").select("user_id, email, preferences, status").in("user_id", userIds);
  const subByUser = new Map((subs || []).map((s: any) => [s.user_id, s]));
  const { data: profs } = await supabase.from("profiles").select("id, display_name").in("id", userIds);
  const nameById = new Map((profs || []).map((p: any) => [p.id, p.display_name]));

  let sent = 0, skipped = 0;
  const processedIds: string[] = [];
  for (const [userId, items] of byUser) {
    const sub = subByUser.get(userId);
    const optedIn = !sub?.preferences || sub.preferences.suivi_depute !== false; // opt-out explicite seulement
    const email = sub?.email;
    if (email && optedIn) {
      const subject = items.length === 1 ? `${items[0].detail}` : `${items.length} votes de vos élus suivis`;
      const ok = await sendEmail(email, subject.slice(0, 120), buildHtml(nameById.get(userId) || "", items));
      if (ok) { sent++; processedIds.push(...items.map(i => i.id)); }
    } else {
      skipped++; processedIds.push(...items.map(i => i.id)); // pas d'e-mail / opt-out → on marque pour ne pas re-traiter
    }
  }

  // Marque comme envoyées (idempotent).
  if (processedIds.length) {
    const now = new Date().toISOString();
    for (let i = 0; i < processedIds.length; i += 200) {
      const { error: e2 } = await supabase.from("user_notifications").update({ emailed_at: now }).in("id", processedIds.slice(i, i + 200));
      if (e2) console.error("[EMAIL] update emailed_at:", e2.message);
    }
  }
  console.log(`Digests envoyés : ${sent} · utilisateurs sans e-mail/opt-out : ${skipped} · notifs marquées : ${processedIds.length}${RESEND_KEY ? "" : " (DRY-RUN, RESEND_API_KEY absente)"}`);
}

main().catch(e => { console.error(e); process.exit(1); });
