import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { envoyerMail, adressesDesMembres, gabarit, rubrique, ligne, bouton, esc, resumeCourt, SITE_URL, simulation } from "../../lib/mail.js";

/**
 * Envoie par e-mail les alertes des membres (user_notifications non encore envoyées).
 *
 * Chaque alerte a une catégorie — votes (élus suivis), local (territoire), suivis
 * (partis, ministères, candidats, commissions), lois — et chaque membre Pro choisit,
 * par catégorie, un rythme : immediat, quotidien, hebdo (seulement dans le récap du
 * samedi) ou aucun. Les autres membres gardent l'ancien fonctionnement : un résumé
 * quotidien de tout ce qui dépasse leur seuil d'importance.
 *
 *   --mode=immediat   (toutes les heures) : les catégories « immediat »
 *   --mode=quotidien  (chaque soir)       : les catégories « quotidien »
 *
 * Une alerte « hebdo » reste en attente : le récap du samedi la reprend et la marque.
 */
const MODE = (process.argv.find(a => a.startsWith("--mode="))?.split("=")[1] || "quotidien") as "immediat" | "quotidien";
const LOOKBACK_DAYS = Number(process.env.EMAIL_LOOKBACK_DAYS || 7);
// Essai : --seul=adresse → ce seul membre, traité comme Pro, alertes laissées en attente.
const SEUL = process.argv.find(a => a.startsWith("--seul="))?.split("=")[1]?.toLowerCase();
const RYTHMES_DEFAUT: Record<string, string> = { votes: "immediat", local: "quotidien", suivis: "quotidien", lois: "hebdo" };

const categorieDe = (n: any): string => n.categorie
  || (n.position || n.type === "vote" ? "votes" : n.type === "local" ? "local" : n.type === "loi" ? "lois" : "suivis");

const INTITULES: Record<string, [string, string, string]> = {
  votes: ["🗳️", "Vos élus ont voté", "#4f46e5"],
  local: ["📍", "Près de chez vous", "#e11d48"],
  suivis: ["⭐", "Ce que vous suivez", "#d97706"],
  lois: ["📜", "Lois", "#059669"],
};
const couleurVote = (p: string) => (p === "POUR" ? "#059669" : p === "CONTRE" ? "#e11d48" : p === "ABSTENTION" ? "#d97706" : "#64748b");

function html(prenom: string, alertes: any[]): string {
  const parCat = new Map<string, any[]>();
  for (const a of alertes) { const c = categorieDe(a); parCat.set(c, [...(parCat.get(c) || []), a]); }
  const blocs = ["votes", "suivis", "local", "lois"].filter(c => parCat.has(c)).map(c => {
    const [emoji, intitule, couleur] = INTITULES[c];
    const lignes = parCat.get(c)!.slice(0, 12).map(n => n.position
      ? ligne({ titre: n.detail || n.title, url: n.url, resume: n.detail ? n.title : null, etiquette: `Vote : ${n.position}`, couleur: couleurVote(n.position) })
      : ligne({ titre: n.title, url: n.url, resume: resumeCourt(n.detail, 160), etiquette: n.place || (c === "suivis" ? n.domain : null), couleur }));
    return rubrique(emoji, intitule, couleur, lignes.join(""));
  }).join("");
  return gabarit({
    preheader: `${alertes.length} alerte${alertes.length > 1 ? "s" : ""} selon vos réglages.`,
    surtitre: MODE === "immediat" ? "Alerte" : "Vos alertes du jour",
    titre: alertes.length === 1 ? "Une alerte pour vous" : `${alertes.length} alertes pour vous`,
    sousTitre: `${prenom ? `Bonjour ${esc(prenom)}, voici` : "Voici"} ce qui vous concerne, d'après les réglages de votre profil.`,
    corps: blocs + bouton("Toutes mes alertes", `${SITE_URL}/dashboard`),
    pied: `Vous recevez ces alertes selon les réglages de votre profil.<br><a href="${SITE_URL}/dashboard#preferences" style="color:#64748b">Modifier mes alertes</a>`,
  });
}

async function main() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const { data: notifs, error } = await supabase.from("user_notifications")
    .select("id, user_id, type, categorie, title, detail, position, importance, domain, url, place, event_at, created_at")
    .is("emailed_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(20000);
  if (error) throw error;
  if (!notifs?.length) { console.log("Aucune alerte en attente."); return; }

  const parMembre = new Map<string, any[]>();
  for (const n of notifs) parMembre.set(n.user_id, [...(parMembre.get(n.user_id) || []), n]);
  let ids = [...parMembre.keys()];

  const { data: profils } = await supabase.from("profiles").select("id, display_name, subscription_tier").in("id", ids);
  const profil = new Map((profils || []).map((p: any) => [p.id, p]));
  const { data: prefs } = await supabase.from("user_preferences").select("user_id, notify_email, email_min_importance, rythmes").in("user_id", ids);
  const pref = new Map((prefs || []).map((p: any) => [p.user_id, p]));
  const { data: abonnes } = await supabase.from("subscribers").select("user_id, email, preferences").in("user_id", ids);
  const abonne = new Map((abonnes || []).map((s: any) => [s.user_id, s]));
  const adresses = await adressesDesMembres(ids);
  if (SEUL) {
    ids = ids.filter(id => (adresses.get(id) || "").toLowerCase() === SEUL);
    for (const k of [...parMembre.keys()]) if (!ids.includes(k)) parMembre.delete(k);
    console.log(`[Essai] ${SEUL} : ${[...parMembre.values()].flat().length} alerte(s) en attente.`);
  }

  let envoyes = 0, ignores = 0; const traites: string[] = [];
  for (const [id, alertes] of parMembre) {
    const p = pref.get(id); const pro = !!SEUL || profil.get(id)?.subscription_tier === "pro";
    const rythmes = { ...RYTHMES_DEFAUT, ...(p?.rythmes || {}) };
    // Rythme d'une catégorie : réglage Pro, sinon résumé quotidien de tout (ancien fonctionnement).
    const rythme = (c: string) => (pro ? rythmes[c] : "quotidien");
    const aucun = alertes.filter(a => rythme(categorieDe(a)) === "aucun");
    const duMode = alertes.filter(a => rythme(categorieDe(a)) === MODE);
    traites.push(...aucun.map(a => a.id));
    if (!duMode.length) continue;
    traites.push(...duMode.map(a => a.id));   // traitées même sous le seuil : jamais renvoyées

    const optIn = p ? p.notify_email !== false : abonne.get(id)?.preferences?.suivi_depute !== false;
    const seuil = p?.email_min_importance ?? 3;
    const aEnvoyer = duMode.filter(a => (a.importance ?? 3) >= seuil || categorieDe(a) === "votes");
    const adresse = abonne.get(id)?.email || adresses.get(id);
    if (!optIn || !adresse || !aEnvoyer.length) { ignores++; continue; }
    const sujet = aEnvoyer.length === 1
      ? resumeCourt(aEnvoyer[0].position ? `Vote : ${aEnvoyer[0].detail || aEnvoyer[0].title}` : aEnvoyer[0].title, 110)
      : `${aEnvoyer.length} alertes pour vous`;
    if (await envoyerMail(adresse, sujet, html(profil.get(id)?.display_name || "", aEnvoyer), { desabo: `${SITE_URL}/dashboard#preferences` })) envoyes++;
    await new Promise(r => setTimeout(r, 600));   // limite de débit Resend
  }

  if (!simulation && !SEUL) {
    const maintenant = new Date().toISOString();
    for (let i = 0; i < traites.length; i += 200) {
      const { error: e } = await supabase.from("user_notifications").update({ emailed_at: maintenant }).in("id", traites.slice(i, i + 200));
      if (e) console.error("[MAIL] emailed_at :", e.message);
    }
  }
  console.log(`[Alertes ${MODE}] ${envoyes} e-mail(s) envoyé(s), ${ignores} membre(s) sans adresse ou désabonné(s), ${traites.length} alerte(s) traitée(s)${simulation ? " — SIMULATION" : ""}.`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
