import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { silenceSondages } from "../../lib/sondage-notice.js";
import { faitsDesAlertes } from "../../lib/faits-suivis.js";
import { envoyerMail, adressesDesMembres, gabarit, rubrique, ligne, ligneEnrichie, bouton, esc, resumeCourt, sujetCourt, SITE_URL, simulation, antiDoublon } from "../../lib/mail.js";
import { enrichir, lireEnrichissements, type Enrichissement } from "../../lib/enrichissement-pro.js";
import { votesRegroupes } from "../../lib/votes-mail.js";

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
/* ─────────── Analyse détaillée du site, dans l'e-mail des membres Pro (24/11/2026) ─────────── */

type AnalyseDetaillee = { analyse_loi: any; cadre: any; sources: { titre: string; url: string }[] | null; generated_at: string | null };
/** Analyses par dossier, et dossiers dont l'analyse a échoué (texte illisible) : on ne promet rien pour ceux-là. */
type Analyses = { parDossier: Map<string, AnalyseDetaillee>; impossibles: Set<string>; niveau?: "Pro" | "Premium" };

const plein = (s: any) => typeof s === "string" && s.trim().length > 1;
const titreBloc = (t: string, couleur = "#b45309") =>
  `<div style="margin:22px 0 10px;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${couleur}">${esc(t)}</div>`;
const para = (t: string, style = "") => `<div style="font-size:14px;line-height:1.6;color:#334155;${style}">${esc(t)}</div>`;

/** L'analyse entière, comme sur la fiche du texte : rien n'est coupé ni résumé. */
function blocAnalyse(a: AnalyseDetaillee, niveau: "Pro" | "Premium" = "Pro"): string {
  const l = a.analyse_loi || {}; const c = a.cadre || null;
  const mesures = (l.mesures || []).filter((m: any) => plein(m.titre));
  let h = `<div style="margin-top:16px;padding:18px;border-radius:16px;border:1px solid #fcd34d;background:#fffbeb">
    <div style="display:inline-block;padding:3px 10px;border-radius:999px;background:#f59e0b;color:#111827;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Analyse ${niveau}</div>
    <div style="font-size:20px;line-height:1.2;font-weight:800;color:#0f172a;margin-top:8px">Analyse détaillée complète</div>
    <div style="font-size:12px;color:#92400e;margin-top:2px">Rédigée d'après le texte officiel${a.generated_at ? ` · ${new Date(a.generated_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" })}` : ""}</div>`;
  if (plein(l.en_une_phrase)) h += para(l.en_une_phrase, "margin-top:12px;font-weight:700;color:#0f172a;font-size:15px");
  if (plein(l.contexte)) h += para(l.contexte, "margin-top:10px");
  if (l.chiffres_cles?.length) {
    h += titreBloc("Les chiffres clés") + `<div style="padding:4px 12px;border-radius:12px;background:#fff;border:1px solid #fde68a">${l.chiffres_cles.map((k: any, i: number) =>
      `<div style="padding:8px 0;${i ? "border-top:1px solid #fef3c7;" : ""}font-size:13px;line-height:1.5;color:#475569"><strong style="font-size:15px;color:#b45309">${esc(k.valeur)}</strong> — ${esc(k.libelle)}</div>`).join("")}</div>`;
  }
  if (mesures.length) {
    h += titreBloc(`Toutes les mesures (${mesures.length})`) + mesures.map((m: any, i: number) => `
      <div style="margin:0 0 12px;padding:14px;border-radius:14px;background:#fff;border:1px solid #e7e2d6">
        <div style="font-size:15px;line-height:1.4;font-weight:800;color:#0f172a"><span style="color:#b45309">${i + 1}.</span> ${esc(m.titre)}</div>
        ${plein(m.article) ? `<div style="margin-top:4px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#64748b">${esc(m.article)}</div>` : ""}
        ${plein(m.avant) ? `<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:#fff1f2;border:1px solid #fecdd3"><div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#e11d48">Avant</div>${para(m.avant, "margin-top:3px;font-size:13px")}</div>` : ""}
        ${plein(m.apres) ? `<div style="margin-top:8px;padding:10px 12px;border-radius:10px;background:#ecfdf5;border:1px solid #a7f3d0"><div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#047857">Ce que change la loi</div>${para(m.apres, "margin-top:3px;font-size:13px")}</div>` : ""}
        ${plein(m.detail) ? para(m.detail, "margin-top:10px;font-size:13.5px") : ""}
        ${plein(m.qui) ? `<div style="margin-top:8px;font-size:12.5px;line-height:1.5;color:#64748b"><strong style="color:#0f172a">Concerne :</strong> ${esc(m.qui)}</div>` : ""}
      </div>`).join("");
  }
  if (l.concernes?.length) h += titreBloc("Ce que ça change, pour qui") + l.concernes.map((p: any) =>
    `<div style="margin:0 0 8px;font-size:13.5px;line-height:1.55;color:#334155"><strong style="color:#0f172a">${esc(p.public)} :</strong> ${esc(p.effet)}</div>`).join("");
  if (l.calendrier?.length) h += titreBloc("Quand ça s'applique") + l.calendrier.map((e: any) =>
    `<div style="margin:0 0 8px;font-size:13.5px;line-height:1.55;color:#334155"><strong style="color:#b45309">${esc(e.quand)}</strong> — ${esc(e.quoi)}</div>`).join("");
  if (l.sanctions?.length) h += titreBloc("Sanctions prévues", "#be123c") + l.sanctions.map((s: string) => para(`• ${s}`, "margin:0 0 6px")).join("");
  if (plein(l.financement)) h += titreBloc("Coût et financement") + para(l.financement);
  if (plein(l.apports_parlement)) h += titreBloc("Ce qu'ont changé les parlementaires") + para(l.apports_parlement);
  if (l.points_debat?.length) h += titreBloc("Les points qui font débat") + l.points_debat.map((p: string) => para(`• ${p}`, "margin:0 0 6px")).join("");
  if (c && (plein(c.synthese) || c.dispositifs?.length)) {
    h += `<div style="margin-top:22px;padding:14px;border-radius:14px;background:#f0f9ff;border:1px solid #bae6fd">
      <div style="font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#0369a1">Ce qui existe déjà sur ce sujet</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px">Le droit qui s'applique aujourd'hui dans ce domaine, indépendamment de ce texte.</div>
      ${plein(c.synthese) ? para(c.synthese, "margin-top:10px") : ""}
      ${(c.dispositifs || []).map((d: any) => `<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:#fff;border:1px solid #e0f2fe"><strong style="font-size:13.5px;color:#0f172a">${esc(d.nom)}</strong>${para(d.description, "margin-top:3px;font-size:13px")}${plein(d.reference) ? `<div style="margin-top:4px;font-size:11px;font-weight:700;color:#0369a1">${esc(d.reference)}</div>` : ""}</div>`).join("")}
      ${(c.chiffres || []).map((k: any) => `<div style="margin-top:8px;font-size:13px;line-height:1.5;color:#334155"><strong style="color:#0369a1">${esc(k.valeur)}</strong> — ${esc(k.libelle)}</div>`).join("")}
      ${c.acteurs?.length ? `<div style="margin-top:10px;font-size:12.5px;line-height:1.5;color:#475569"><strong style="color:#0f172a">Qui intervient aujourd'hui :</strong> ${esc(c.acteurs.join(" · "))}</div>` : ""}
      ${plein(c.lacunes) ? `<div style="margin-top:6px;font-size:12.5px;line-height:1.5;color:#475569"><strong style="color:#0f172a">Ce que le droit actuel ne règle pas :</strong> ${esc(c.lacunes)}</div>` : ""}
    </div>`;
  }
  if (plein(l.limites)) h += `<div style="margin-top:16px;font-size:12px;line-height:1.5;font-style:italic;color:#78716c">${esc(l.limites)}</div>`;
  if (a.sources?.length) h += `<div style="margin-top:10px;font-size:11.5px;color:#78716c">Documents lus : ${a.sources.map(s => `<a href="${esc(s.url)}" style="color:#92400e">${esc(s.titre)}</a>`).join(" · ")}. Analyse rédigée avec l'aide d'une IA à partir de ces documents officiels.</div>`;
  return h + `</div>`;
}

function carteTexte(n: any, analyses?: Analyses | null): string {
  const d = n.donnees || {}; const r = d.resultat;
  // Membre Pro : l'analyse détaillée du site, entière ; à défaut, elle est annoncée pour plus tard.
  const dossier = d.dossier_id ? String(d.dossier_id) : null;
  const analyse = analyses && dossier ? analyses.parDossier.get(dossier) : undefined;
  const suite = analyse ? blocAnalyse(analyse, analyses?.niveau)
    : analyses && dossier && !analyses.impossibles.has(dossier)
    ? `<div style="margin-top:12px;padding:10px 12px;border-radius:12px;background:#fffbeb;border:1px solid #fde68a;font-size:13px;line-height:1.5;color:#92400e"><strong>Analyse détaillée en cours de rédaction.</strong> Elle est écrite à partir du texte officiel, mesure par mesure : vous la recevrez par e-mail dès qu'elle sera prête.</div>`
    : "";
  if (d.source === "analyse") {
    return `<div style="padding:18px 0;border-bottom:1px solid #e7e2d6">
    <div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#b45309">Analyse détaillée · ${d.chambre === "SENAT" ? "texte voté au Sénat" : "texte voté à l'Assemblée nationale"}</div>
    <div style="font-size:17px;line-height:1.35;font-weight:800;color:#0f172a;margin-top:5px"><a href="${esc(n.url || SITE_URL)}" style="color:#0f172a;text-decoration:none">${esc(n.title)}</a></div>
    ${r ? `<div style="margin-top:6px;font-size:13px;color:#475569">${r.adopte ? "Adopté" : "Rejeté"}${r.pour != null ? ` (${r.pour} pour, ${r.contre} contre, ${r.abstention} abstentions)` : ""}.</div>` : ""}
    ${suite}
  </div>`;
  }
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
    ${d.extrait && /[.!?»)]$/.test(String(d.extrait).trim()) ? `<div style="margin-top:8px;padding-left:10px;border-left:3px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b;font-style:italic">Extrait du résumé officiel : « ${esc(d.extrait)} »</div>` : ""}
    ${vote}${elus}${partis}${suite}
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

/** Alertes de vote d'un élu suivi (une par scrutin et par élu) : regroupées par texte dans l'e-mail. */
const estVoteElu = (n: any) => categorieDe(n) === "votes" && !!n.position && n.type === "vote";

async function html(prenom: string, alertes: any[], enrichis: Map<string, Enrichissement> = new Map(), analyses: Analyses | null = null): Promise<{ html: string; unites: number; votes: Awaited<ReturnType<typeof votesRegroupes>> | null }> {
  const parCat = new Map<string, any[]>();
  for (const a of alertes) { const c = categorieDe(a); parCat.set(c, [...(parCat.get(c) || []), a]); }
  const textes = (parCat.get("textes") || []).map(n => carteTexte(n, analyses)).join("");
  const seulementAnalyses = (parCat.get("textes") || []).every(t => t.donnees?.source === "analyse");
  const votes = (parCat.get("textes") || []).every(t => t.donnees?.source === "scrutin_final" || t.donnees?.source === "analyse");
  // Votes des élus suivis : un bloc par texte (bilan de chaque élu, quelques votes expliqués), plus une ligne par vote.
  const votesElus = (parCat.get("votes") || []).filter(estVoteElu);
  const autresVotes = (parCat.get("votes") || []).filter(n => !estVoteElu(n));
  if (autresVotes.length) parCat.set("votes", autresVotes); else parCat.delete("votes");
  const regroupes = votesElus.length ? await votesRegroupes(votesElus) : null;
  const blocVotes = regroupes?.html ? rubrique(...(INTITULES.votes as [string, string, string]), regroupes.html) : "";
  const blocs = (textes ? rubrique(seulementAnalyses ? "📘" : votes ? "🗳️" : "📜", seulementAnalyses ? "Analyse détaillée d'un texte voté" : votes ? "Textes votés au Parlement" : "Un texte vous concerne", seulementAnalyses ? "#b45309" : "#7c3aed", textes) : "") + ["veille", "decrets", "amendements", "votes", "suivis", "local", "lois"].filter(c => parCat.has(c) || (c === "votes" && blocVotes)).map(c => {
    const [emoji, intitule, couleur] = INTITULES[c];
    if (c === "votes" && blocVotes) return blocVotes + (parCat.has("votes") ? parCat.get("votes")!.slice(0, 12).map(n => ligne({ titre: n.title, url: n.url, resume: resumeCourt(n.detail, 160), couleur })).join("") : "");
    const lignes = parCat.get(c)!.slice(0, 12).map(n => n.position
      ? ligne({ titre: n.detail || n.title, url: n.url, resume: n.detail ? n.title : null, etiquette: `Vote : ${n.position}`, couleur: couleurVote(n.position) })
      : enrichis.has(String(n.id))
      ? ligneEnrichie({ titre: n.title, url: n.url, etiquette: n.place || (c === "suivis" || c === "veille" ? n.domain : null) }, enrichis.get(String(n.id))!, couleur)
      : ligne({ titre: n.title, url: n.url, resume: resumeCourt(n.detail, c === "veille" ? 280 : 160), etiquette: n.place || (c === "suivis" || c === "veille" ? n.domain : null), couleur }));
    return rubrique(emoji, intitule, couleur, lignes.join(""));
  }).join("");
  // Compte affiché : un texte voté compte pour une alerte, quel que soit le nombre de votes dessus.
  const unites = alertes.length - votesElus.length + (regroupes?.nbTextes || 0);
  return { unites, votes: regroupes, html: gabarit({
    preheader: regroupes && unites === regroupes.nbTextes ? `Vos élus ont voté ${regroupes.nbVotes} fois sur ${regroupes.nbTextes} texte${regroupes.nbTextes > 1 ? "s" : ""}.` : `${unites} alerte${unites > 1 ? "s" : ""} selon vos réglages.`,
    surtitre: MODE === "immediat" ? "Alerte" : "Vos alertes du jour",
    titre: unites === 1 ? "Une alerte pour vous" : `${unites} alertes pour vous`,
    sousTitre: `${prenom ? `Bonjour ${esc(prenom)}, voici` : "Voici"} ce qui vous concerne, d'après les réglages de votre profil.`,
    corps: blocs + bouton("Toutes mes alertes", `${SITE_URL}/dashboard`),
    pied: `Vous recevez ces alertes selon les réglages de votre profil.<br><a href="${SITE_URL}/dashboard#preferences" style="color:#64748b">Modifier mes alertes</a>`,
  }) };
}

/**
 * Actes du Journal officiel (décrets, arrêtés, nominations…) dans les alertes : l'explication d'une
 * phrase ne suffisait pas (23/11/2026, demande de l'éditeur). Ils reçoivent l'enrichissement de
 * l'e-mail Pro (l'essentiel, faits clés, qui est concerné, la suite), rédigé une fois par acte
 * (clé « jotexte:<JORFTEXT…> », partagée avec digest-pro) et servi à tous les membres.
 * Retourne l'enrichissement par identifiant d'alerte.
 */
const CATS_ENRICHIES = new Set(["lois", "suivis", "local", "decrets"]);
async function enrichissementsJo(notifs: any[]): Promise<Map<string, Enrichissement>> {
  const res = new Map<string, Enrichissement>();
  const jo = notifs.filter(n => !n.position && CATS_ENRICHIES.has(categorieDe(n)) && /legifrance\.gouv\.fr/.test(n.url || ""));
  if (!jo.length) return res;
  const idDe = new Map<string, string>();
  for (const n of jo) { const m = /JORFTEXT\d+/.exec(n.url || ""); if (m) idDe.set(String(n.id), m[0]); }
  // Lien ELI (sans identifiant JORF) : l'acte est retrouvé par son explication, reprise telle quelle dans l'alerte.
  for (const n of jo.filter(x => !idDe.has(String(x.id)) && x.detail)) {
    const motif = String(n.detail).trim().replace(/[%_\\]/g, c => `\\${c}`);
    const { data } = await supabase.from("jorf_texts").select("id").ilike("explication", motif).limit(1);
    if (data?.[0]?.id) idDe.set(String(n.id), data[0].id);
  }
  const infos = [...new Map(jo.filter(n => idDe.has(String(n.id))).map(n => {
    const cle = `jotexte:${idDe.get(String(n.id))}`;
    return [cle, { cle, titre: n.title, resume: n.detail, url: n.url }];
  })).values()];
  const enr = await lireEnrichissements(infos.map(i => i.cle));
  const manquants = infos.filter(i => !enr.has(i.cle));
  if (manquants.length && !process.argv.includes("--sans-ia"))
    for (const [k, v] of await enrichir(manquants, { budget: Number(process.env.ALERTES_IA_BUDGET || 0.4) })) enr.set(k, v);
  for (const n of jo) { const e = enr.get(`jotexte:${idDe.get(String(n.id))}`); if (e) res.set(String(n.id), e); }
  console.log(`[Alertes] Journal officiel : ${res.size}/${jo.length} alerte(s) enrichie(s).`);
  return res;
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
    .select("id, user_id, type, categorie, title, detail, position, importance, domain, url, place, event_at, created_at, donnees, scrutin_id, dedup_key, senator_id, deputy_id, mep_id")
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
  const enrichis = await enrichissementsJo(notifs);
  // Analyses détaillées des textes votés (jointes aux e-mails des membres Pro).
  const dossiersVotes = [...new Set(notifs.filter(n => categorieDe(n) === "textes" && n.donnees?.dossier_id).map(n => String(n.donnees.dossier_id)))];
  const analyses: Analyses = { parDossier: new Map(), impossibles: new Set() };
  if (dossiersVotes.length) {
    const { data: lues } = await supabase.from("dossier_analyses_approfondies").select("dossier_id, analyse_loi, cadre, sources, generated_at").in("dossier_id", dossiersVotes);
    for (const a of lues || []) analyses.parDossier.set(String(a.dossier_id), a as AnalyseDetaillee);
    const { data: ratees } = await supabase.from("dossier_analyses_tentatives").select("dossier_id").in("dossier_id", dossiersVotes);
    for (const t of ratees || []) if (!analyses.parDossier.has(String(t.dossier_id))) analyses.impossibles.add(String(t.dossier_id));
    console.log(`[Alertes] Analyses détaillées : ${analyses.parDossier.size}/${dossiersVotes.length} texte(s) voté(s) prêt(s).`);
  }
  /** Alertes de vote parties AVEC leur analyse : marquées, pour qu'elle ne reparte pas seule (alertes-textes). */
  const jointes: any[] = [];
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
    const t0Vote = t0?.donnees?.source === "scrutin_final" ? `${t0.donnees?.resultat?.adopte ? "Adopté" : "Rejeté"} ${t0.donnees?.chambre === "AN" ? "à l'Assemblée" : "au Sénat"}`
      : t0?.donnees?.source === "analyse" ? "Analyse détaillée" : "Journal officiel";
    // Premium et Pro : l'analyse détaillée du site leur est ouverte, elle part donc aussi dans leurs e-mails.
    const lecteurAnalyse = pro || profil.get(id)?.subscription_tier === "elite";
    const rendu = await html(profil.get(id)?.display_name || "", aEnvoyer, enrichis, lecteurAnalyse ? { ...analyses, niveau: pro ? "Pro" : "Premium" } : null);
    if (lecteurAnalyse) jointes.push(...aEnvoyer.filter(a => a.donnees?.source === "scrutin_final" && a.donnees?.dossier_id && analyses.parDossier.has(String(a.donnees.dossier_id))));
    const rv = rendu.votes;
    const sujet = t0 ? sujetCourt(`${t0Vote} : ${t0.title}`, 110)
      // Que des votes d'élus suivis : le texte, pas le nombre de scrutins (« 30 alertes pour vous »).
      : rv && rendu.unites === rv.nbTextes
      ? sujetCourt(`Vos élus ont voté${rv.texte && rv.texte !== "Autres votes" ? ` : ${rv.texte}` : ""}${rv.nbTextes > 1 ? ` (et ${rv.nbTextes - 1} autre${rv.nbTextes > 2 ? "s" : ""} texte${rv.nbTextes > 2 ? "s" : ""})` : ""}`, 110)
      : rendu.unites === 1 && aEnvoyer.length === 1
      ? sujetCourt(aEnvoyer[0].position ? `Vote : ${aEnvoyer[0].detail || aEnvoyer[0].title}`
        : ["suivis", "veille"].includes(categorieDe(aEnvoyer[0])) && aEnvoyer[0].domain ? `${aEnvoyer[0].domain} : ${aEnvoyer[0].title}` : aEnvoyer[0].title, 110)
      : `${rendu.unites} alertes pour vous`;
    const apercu = process.argv.find(x => x.startsWith("--apercu="))?.split("=").slice(1).join("=");
    if (apercu) { (await import("node:fs")).writeFileSync(apercu, rendu.html); console.log(`Aperçu : ${apercu} — sujet « ${sujet} »`); return; }
    if (await envoyerMail(adresse, sujet, rendu.html, { desabo: `${SITE_URL}/dashboard#preferences` })) envoyes++;
    await new Promise(r => setTimeout(r, 600));   // limite de débit Resend
  }

  if (!simulation && !SEUL) {
    const maintenant = new Date().toISOString();
    for (let i = 0; i < traites.length; i += 200) {
      const { error: e } = await supabase.from("user_notifications").update({ emailed_at: maintenant }).in("id", traites.slice(i, i + 200));
      if (e) console.error("[MAIL] emailed_at :", e.message);
    }
    for (const a of jointes) {
      const { error: e } = await supabase.from("user_notifications").update({ donnees: { ...a.donnees, analyse_jointe: true } }).eq("id", a.id);
      if (e) console.error("[MAIL] analyse_jointe :", e.message);
    }
  }
  console.log(`[Alertes ${MODE}] ${envoyes} e-mail(s) envoyé(s), ${ignores} membre(s) sans adresse ou désabonné(s), ${traites.length} alerte(s) traitée(s)${simulation ? " — SIMULATION" : ""}.`);
}

// Lancé seulement en direct : un aperçu peut importer le rendu (blocAnalyse, carteTexte) sans rien envoyer.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("send-notification-emails.ts")) main().catch(e => { console.error(e); process.exitCode = 1; });

export { blocAnalyse, carteTexte, html as rendreEmail };
