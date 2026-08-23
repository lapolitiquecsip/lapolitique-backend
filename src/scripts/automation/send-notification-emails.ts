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
//   SITE_URL         ex. "https://lapolitiquecestsimple.fr" (liens)
// Dry-run si RESEND_API_KEY absente : log seulement, n'écrit rien.

const SITE_URL = process.env.SITE_URL || "https://lapolitiquecestsimple.fr";
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

// Digest générique : gère les notifs de VOTE (position) et les alertes THÉMATIQUES (domaine + lien).
function buildHtml(displayName: string, items: any[]): string {
  const rows = items.map(n => {
    const isVote = !!n.position;
    const headline = esc(isVote ? (n.detail || n.title || "") : (n.title || n.detail || ""));
    const sub = isVote ? esc(n.title || "") : (n.title && n.detail ? esc(n.detail) : "");
    const link = n.url ? ` &nbsp;<a href="${esc(n.url)}" style="color:#2563eb;text-decoration:none;font-weight:700">Lire →</a>` : "";
    const tag = isVote
      ? `<span style="display:inline-block;margin-top:6px;font-size:11px;font-weight:800;letter-spacing:.06em;color:${posColor(n.position)}">VOTE : ${esc(n.position || "")}</span>`
      : (n.domain ? `<span style="display:inline-block;margin-top:6px;font-size:11px;font-weight:800;letter-spacing:.06em;color:#b45309;text-transform:uppercase">${esc(n.domain)}</span>` : "");
    return `
    <tr><td style="padding:12px 0;border-bottom:1px solid #eef2f7">
      <div style="font-weight:700;color:#0f172a;font-size:15px">${headline}</div>
      ${sub || link ? `<div style="color:#475569;font-size:13px;margin-top:2px">${sub}${link}</div>` : ""}
      ${tag}
    </td></tr>`;
  }).join("");
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;padding:24px">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:28px">
        <h1 style="font-size:18px;color:#0f172a;margin:0 0 4px">Vos alertes personnalisées</h1>
        <p style="color:#64748b;font-size:13px;margin:0 0 16px">${esc(displayName ? "Bonjour " + displayName + "," : "Bonjour,")} voici les informations importantes qui vous concernent.</p>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
        <a href="${SITE_URL}/dashboard" style="display:inline-block;margin-top:20px;background:#0f172a;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 18px;border-radius:10px">Voir mon tableau de bord</a>
        <p style="color:#94a3b8;font-size:11px;margin-top:20px">Vous recevez cet e-mail selon les réglages de votre profil sur La Politique C'est Simple. Ajustez vos centres d'intérêt et le niveau d'alerte depuis votre tableau de bord.</p>
      </div>
    </div></body></html>`;
}

async function main() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  // Notifications non envoyées, récentes.
  const { data: notifs, error } = await supabase
    .from("user_notifications")
    .select("id, user_id, title, detail, position, importance, domain, url, event_at, created_at")
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
  // Réglages premium : opt-in e-mail + seuil d'importance (les notifs restent toujours dans le fil).
  const { data: prefsRows } = await supabase.from("user_preferences").select("user_id, notify_email, email_min_importance").in("user_id", userIds);
  const prefByUser = new Map((prefsRows || []).map((p: any) => [p.user_id, p]));

  let sent = 0, skipped = 0;
  const processedIds: string[] = [];
  for (const [userId, items] of byUser) {
    const sub = subByUser.get(userId);
    const pref = prefByUser.get(userId);
    const email = sub?.email;
    // Opt-in : préférence premium si présente, sinon ancien opt-out `subscribers`.
    const optedIn = pref ? pref.notify_email !== false : (!sub?.preferences || sub.preferences.suivi_depute !== false);
    const threshold = pref?.email_min_importance ?? 3;
    // Seules les alertes au niveau d'importance choisi (ou +) partent par e-mail ; le reste reste dans le fil.
    const toEmail = items.filter(i => (i.importance ?? 3) >= threshold);
    if (email && optedIn && toEmail.length) {
      const subject = toEmail.length === 1 ? `${toEmail[0].detail || toEmail[0].title}` : `${toEmail.length} alertes pour vous`;
      const ok = await sendEmail(email, subject.slice(0, 120), buildHtml(nameById.get(userId) || "", toEmail));
      if (ok) sent++;
    } else {
      skipped++;
    }
    processedIds.push(...items.map(i => i.id)); // toujours marquer traité (envoyées + sous-seuil) pour ne pas re-traiter
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
