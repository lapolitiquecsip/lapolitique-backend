import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { silenceSondages } from "../../lib/sondage-notice.js";
import { faitsDesAlertes } from "../../lib/faits-suivis.js";
import { envoyerMail, adressesDesMembres, gabarit, rubrique, ligne, bouton, esc, resumeCourt, SITE_URL, simulation, antiDoublon } from "../../lib/mail.js";

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
// --categorie=amendements : seulement cette catégorie (envoi juste après le relevé horaire des
// amendements) ; --sauf=amendements : toutes les autres (cron horaire des alertes). Deux
// passages ne se disputent ainsi jamais la même alerte.
const SEULE_CAT = process.argv.find(a => a.startsWith("--categorie="))?.split("=")[1];
const SAUF_CAT = process.argv.find(a => a.startsWith("--sauf="))?.split("=")[1];
// Essai : --seul=adresse → ce seul membre, traité comme Pro, alertes laissées en attente.
const SEUL = process.argv.find(a => a.startsWith("--seul="))?.split("=")[1]?.toLowerCase();
const RYTHMES_DEFAUT: Record<string, string> = { votes: "immediat", local: "quotidien", suivis: "quotidien", lois: "hebdo" };

const categorieDe = (n: any): string => n.categorie
  || (n.position || n.type === "vote" ? "votes" : n.type === "local" ? "local" : n.type === "loi" ? "lois" : "suivis");

/* Alerte de texte : résultat du vote, groupes, élus et partis suivis, extrait officiel. */
const POSITION: Record<string, [string, string]> = {
  for: ["pour", "#059669"], against: ["contre", "#e11d48"], abstain: ["abstention", "#d97706"], POUR: ["pour", "#059669"], CONTRE: ["contre", "#e11d48"], ABSTENTION: ["abstention", "#d97706"],
  pour: ["pour", "#059669"], contre: ["contre", "#e11d48"], abstention: ["abstention", "#d97706"],
};
const aVote = (p: string) => (POSITION[p] ? `a voté <strong style="color:${POSITION[p][1]}">${POSITION[p][0]}</strong>` : "n'a <strong>pas pris part au vote</strong>");
function carteTexte(n: any): string {
  const d = n.donnees || {}; const r = d.resultat;
  const jour = d.date_vote ? ` · ${new Date(d.date_vote).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" })}` : "";
  const sur = d.source === "scrutin_final" ? `${d.intitule || "Vote final"} · ${d.chambre === "AN" ? "Assemblée nationale" : "Sénat"}${jour}` : d.source === "loi" ? "Loi · Journal officiel" : "Décret · Journal officiel";
  let vote = "";
  if (r && (r.pour != null)) {
    const total = (r.pour || 0) + (r.contre || 0) + (r.abstention || 0) || 1;
    const pc = (x: number) => Math.round((x / total) * 100);
    vote = `<div style="margin-top:14px">
      <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#fff;background:${r.adopte ? "#059669" : "#e11d48"}">${r.adopte ? "Adopté" : "Rejeté"}</span>
      <table role="presentation" width="100%" style="margin-top:10px;border-collapse:collapse"><tr>
        ${r.pour ? `<td style="height:10px;background:#059669;width:${pc(r.pour)}%"></td>` : ""}${r.contre ? `<td style="height:10px;background:#e11d48;width:${pc(r.contre)}%"></td>` : ""}${r.abstention ? `<td style="height:10px;background:#f59e0b;width:${pc(r.abstention)}%"></td>` : ""}
      </tr></table>
      <div style="font-size:13px;color:#334155;margin-top:6px"><strong style="color:#059669">${r.pour} pour</strong> · <strong style="color:#e11d48">${r.contre} contre</strong> · <strong style="color:#d97706">${r.abstention} abstentions</strong></div>
      ${(r.groupes || []).length ? `<table role="presentation" width="100%" style="margin-top:10px;border-collapse:collapse;font-size:12px">
        <tr><td style="padding:4px 0;color:#94a3b8;font-weight:700">Groupe</td><td align="right" style="color:#059669;font-weight:800">Pour</td><td align="right" style="color:#e11d48;font-weight:800">Contre</td><td align="right" style="color:#d97706;font-weight:800">Abst.</td></tr>
        ${r.groupes.map((g: any) => `<tr style="border-top:1px solid #eef2f7"><td style="padding:5px 8px 5px 0;color:#0f172a">${esc(g.nom)}</td><td align="right">${g.pour || "–"}</td><td align="right">${g.contre || "–"}</td><td align="right">${g.abstention || "–"}</td></tr>`).join("")}
      </table>` : ""}
    </div>`;
  }
  const elus = (d.elus || []).length ? `<div style="margin-top:12px;padding:10px 12px;border-radius:12px;background:#eef2ff;font-size:13px;line-height:1.55;color:#1e1b4b"><strong>Vos élus :</strong> ${d.elus.map((e: any) => `${esc(e.nom)} ${aVote(e.position)}`).join(" · ")}</div>` : "";
  // Partis suivis : la position majoritaire de leur groupe dans cette chambre, avec le décompte.
  const partis = (d.partis || []).length ? `<div style="margin-top:8px;padding:10px 12px;border-radius:12px;background:#fdf4ff;font-size:13px;line-height:1.55;color:#4a044e"><strong>Vos partis :</strong> ${d.partis.map((p: any) => !p.groupe
    ? `${esc(p.nom)} : pas de groupe ${d.chambre === "AN" ? "à l'Assemblée" : "au Sénat"}`
    : p.position === "absent" ? `${esc(p.groupe)} n'a <strong>pas pris part au vote</strong>`
    : `${esc(p.groupe)} ${p.position === "partage" ? "s'est <strong>divisé</strong>" : aVote(p.position)} (${p.pour} pour, ${p.contre} contre, ${p.abstention} abst.)`).join(" · ")}</div>` : "";
  return `<div style="padding:18px 0;border-bottom:1px solid #e7e2d6">
    <div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#7c3aed">${esc(sur)}</div>
    <div style="font-size:17px;line-height:1.35;font-weight:800;color:#0f172a;margin-top:5px"><a href="${esc(n.url || SITE_URL)}" style="color:#0f172a;text-decoration:none">${esc(n.title)}</a></div>
    ${(d.pourquoi || []).length ? `<div style="margin-top:8px;font-size:12px;color:#7c3aed;font-weight:700">Pour vous : ${esc(d.pourquoi.join(" ; "))}</div>` : ""}
    ${n.detail ? `<div style="font-size:14px;line-height:1.55;color:#334155;margin-top:8px">${esc(n.detail)}</div>` : ""}
    ${d.extrait ? `<div style="margin-top:8px;padding-left:10px;border-left:3px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b;font-style:italic">Extrait du résumé officiel : « ${esc(d.extrait)}${/[.!?»)]$/.test(d.extrait) ? "" : "…"} »</div>` : ""}
    ${vote}${elus}${partis}
  </div>`;
}

const INTITULES: Record<string, [string, string, string]> = {
  votes: ["🗳️", "Vos élus ont voté", "#4f46e5"],
  local: ["📍", "Près de chez vous", "#e11d48"],
  suivis: ["⭐", "Ce que vous suivez", "#d97706"],
  lois: ["📜", "Lois et décrets de vos sujets", "#059669"],
  amendements: ["✍️", "Nouveaux amendements", "#7c3aed"],
  decrets: ["📑", "Décrets d'application des lois suivies", "#059669"],
  veille: ["🔎", "Vos veilles", "#0891b2"],
};
const couleurVote = (p: string) => (p === "POUR" ? "#059669" : p === "CONTRE" ? "#e11d48" : p === "ABSTENTION" ? "#d97706" : "#64748b");

function html(prenom: string, alertes: any[]): string {
  const parCat = new Map<string, any[]>();
  for (const a of alertes) { const c = categorieDe(a); parCat.set(c, [...(parCat.get(c) || []), a]); }
  const textes = (parCat.get("textes") || []).map(carteTexte).join("");
  const votes = (parCat.get("textes") || []).every(t => t.donnees?.source === "scrutin_final");
  const blocs = (textes ? rubrique(votes ? "🗳️" : "📜", votes ? "Textes votés au Parlement" : "Un texte vous concerne", "#7c3aed", textes) : "") + ["veille", "decrets", "amendements", "votes", "suivis", "local", "lois"].filter(c => parCat.has(c)).map(c => {
    const [emoji, intitule, couleur] = INTITULES[c];
    const lignes = parCat.get(c)!.slice(0, 12).map(n => n.position
      ? ligne({ titre: n.detail || n.title, url: n.url, resume: n.detail ? n.title : null, etiquette: `Vote : ${n.position}`, couleur: couleurVote(n.position) })
      : ligne({ titre: n.title, url: n.url, resume: resumeCourt(n.detail, c === "veille" ? 280 : 160), etiquette: n.place || (c === "suivis" || c === "veille" ? n.domain : null), couleur }));
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

/** Le même fait n'apparaît qu'une fois dans l'e-mail : la première alerte le garde et
 *  reprend l'étiquette des autres (« Jean-Luc Mélenchon · LFI »). Les votes ne sont pas comparés. */
const ORDRE = ["textes", "veille", "decrets", "amendements", "votes", "suivis", "local", "lois"];
function sansDoublons(alertes: any[], faits: Map<string, string>): { gardees: any[]; doublons: any[] } {
  const nouveau = antiDoublon();
  const gardees: any[] = []; const doublons: any[] = [];
  const triees = [...alertes].sort((a, b) => ORDRE.indexOf(categorieDe(a)) - ORDRE.indexOf(categorieDe(b)) || (b.importance ?? 3) - (a.importance ?? 3));
  for (const a of triees) {
    if (a.position || /^vote/.test(a.type || "") || categorieDe(a) === "textes") { gardees.push(a); continue; }
    if (nouveau(a.title, a.url, faits.get(String(a.id)))) { gardees.push({ ...a }); continue; }
    doublons.push(a);
    const t = String(a.title || "").toLowerCase();
    const f = faits.get(String(a.id));
    const k = gardees.find(g => !g.position && String(g.title || "").toLowerCase() === t) || gardees.find(g => !g.position && g.url && g.url === a.url)
      || (f ? gardees.find(g => faits.get(String(g.id)) === f) : undefined);
    if (k && a.domain && !String(k.domain || "").split(" · ").includes(a.domain)) k.domain = k.domain ? `${k.domain} · ${a.domain}` : a.domain;
  }
  return { gardees, doublons };
}

async function main() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const { data: notifs, error } = await supabase.from("user_notifications")
    .select("id, user_id, type, categorie, title, detail, position, importance, domain, url, place, event_at, created_at, donnees, scrutin_id, dedup_key")
    .is("emailed_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(20000);
  if (error) throw error;
  // Veille et jour du vote : les sondages ne partent pas (loi de 1977, art. 11) ; périmés ensuite, on les clôt.
  if (silenceSondages() && !SEUL) {
    const bloques = (notifs || []).filter(n => n.type === "sondage").map(n => n.id);
    if (bloques.length) await supabase.from("user_notifications").update({ emailed_at: new Date().toISOString() }).in("id", bloques);
    notifs?.splice(0, notifs.length, ...notifs.filter(n => n.type !== "sondage"));
  }
  if (notifs && (SEULE_CAT || SAUF_CAT)) notifs.splice(0, notifs.length, ...notifs.filter(n => (SEULE_CAT ? categorieDe(n) === SEULE_CAT : true) && (SAUF_CAT ? categorieDe(n) !== SAUF_CAT : true)));
  if (!notifs?.length) { console.log("Aucune alerte en attente."); return; }

  const faits = await faitsDesAlertes(notifs);
  const parMembre = new Map<string, any[]>();
  for (const n of notifs) parMembre.set(n.user_id, [...(parMembre.get(n.user_id) || []), n]);
  let ids = [...parMembre.keys()];

  const { data: profils } = await supabase.from("profiles").select("id, display_name, subscription_tier").in("id", ids);
  const profil = new Map((profils || []).map((p: any) => [p.id, p]));
  const { data: prefs } = await supabase.from("user_preferences").select("user_id, notify_email, email_min_importance, rythmes").in("user_id", ids);
  // Votes déjà servis par une alerte de texte (qui donne le vote des élus et des partis suivis) :
  // la ligne « votre élu a voté » du même scrutin ferait doublon dans un e-mail suivant.
  const couverts = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("user_notifications").select("user_id, scrutin_id").eq("categorie", "textes")
      .not("scrutin_id", "is", null).in("user_id", ids.slice(i, i + 200)).gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString());
    for (const t of data || []) couverts.add(`${t.user_id}|${t.scrutin_id}`);
  }
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
  for (const [id, toutes] of parMembre) {
    const p = pref.get(id); const pro = !!SEUL || profil.get(id)?.subscription_tier === "pro";
    const dejaServis = toutes.filter(a => (a.type === "vote" || a.type === "vote_parti") && a.scrutin_id && couverts.has(`${id}|${a.scrutin_id}`));
    traites.push(...dejaServis.map(a => a.id));
    const alertes = toutes.filter(a => !dejaServis.includes(a));
    const rythmes = { ...RYTHMES_DEFAUT, ...(p?.rythmes || {}) };
    // Rythme d'une catégorie : réglage Pro, sinon résumé quotidien de tout (ancien fonctionnement).
    // Membre Pro : seule l'alerte « un texte vous concerne » part sur le moment ;
    // tout le reste (votes courants, suivis, local) attend le récap du samedi.
    void rythmes;
    // Pro : les textes qui le concernent tout de suite ; un fait MAJEUR (importance 5 :
    // candidature, programme publié, mise en examen, alliance…) d'un parti ou d'un candidat
    // qu'il suit aussi ; tout le reste attend le récap du samedi.
    const rythme = (n: any): string => {
      const c = categorieDe(n);
      // Amendements des textes et groupes suivis (Pro) : dès le relevé horaire, c'est leur raison d'être.
      if (c === "textes" || c === "amendements" || c === "decrets") return "immediat";
      // Veilles par sujet : le rythme choisi pour chacune.
      if (c === "veille") return n.donnees?.rythme || "quotidien";
      if (pro) return c === "suivis" && (n.importance ?? 0) >= 5 ? "immediat" : "hebdo";
      return "quotidien";
    };
    const aucun = alertes.filter(a => rythme(a) === "aucun");
    // Veilles « chaque semaine » : avec l'envoi du soir, le dimanche (heure de Paris).
    const dimanche = new Date().toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/Paris" }) === "Sunday";
    const duMode = alertes.filter(a => rythme(a) === MODE || (MODE === "quotidien" && dimanche && categorieDe(a) === "veille" && rythme(a) === "hebdo"));
    traites.push(...aucun.map(a => a.id));
    if (!duMode.length) continue;
    traites.push(...duMode.map(a => a.id));   // traitées même sous le seuil : jamais renvoyées

    const optIn = p ? p.notify_email !== false : abonne.get(id)?.preferences?.suivi_depute !== false;
    // « Chaque texte voté » coché : demande explicite, servie même si les autres alertes e-mail sont coupées.
    const chaqueVote = p?.rythmes?.textes_votes === "immediat";
    const seuil = p?.email_min_importance ?? 3;
    // Une veille est une demande explicite : servie même si les autres alertes e-mail sont coupées.
    const retenues = duMode.filter(a => (optIn || categorieDe(a) === "veille" || (chaqueVote && categorieDe(a) === "textes"))
      && ((a.importance ?? 3) >= seuil || ["votes", "amendements", "decrets", "textes", "veille"].includes(categorieDe(a))));
    const { gardees: aEnvoyer, doublons } = sansDoublons(retenues, faits);
    if (doublons.length) console.log(`  ${id.slice(0, 8)} : ${doublons.length} doublon(s) retiré(s) de l'e-mail.`);
    const adresse = abonne.get(id)?.email || adresses.get(id);
    if (!adresse || !aEnvoyer.length) { ignores++; continue; }
    const t0 = aEnvoyer.find(a => categorieDe(a) === "textes");
    const t0Vote = t0?.donnees?.source === "scrutin_final" ? `${t0.donnees?.resultat?.adopte ? "Adopté" : "Rejeté"} ${t0.donnees?.chambre === "AN" ? "à l'Assemblée" : "au Sénat"}` : "Journal officiel";
    const sujet = t0 ? resumeCourt(`${t0Vote} : ${t0.title}`, 110)
      : aEnvoyer.length === 1
      ? resumeCourt(aEnvoyer[0].position ? `Vote : ${aEnvoyer[0].detail || aEnvoyer[0].title}`
        : ["suivis", "veille"].includes(categorieDe(aEnvoyer[0])) && aEnvoyer[0].domain ? `${aEnvoyer[0].domain} : ${aEnvoyer[0].title}` : aEnvoyer[0].title, 110)
      : `${aEnvoyer.length} alertes pour vous`;
    const apercu = process.argv.find(x => x.startsWith("--apercu="))?.split("=").slice(1).join("=");
    if (apercu) { (await import("node:fs")).writeFileSync(apercu, html(profil.get(id)?.display_name || "", aEnvoyer)); console.log(`Aperçu : ${apercu}`); return; }
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
