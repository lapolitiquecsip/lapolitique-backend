import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { fetchAll, resolveLocation, importanceOf } from "./generate-interest-notifications.js";
import { envoyerMail, adressesDesMembres, gabarit, rubrique, ligne, bouton, esc, resumeCourt, SITE_URL, COULEURS, simulation } from "../../lib/mail.js";
import { enrichir, lireEnrichissements, type Enrichissement } from "../../lib/enrichissement-pro.js";

/**
 * E-mails à la carte des membres Pro — chaque jour ou chaque semaine, par catégorie.
 *
 * Le membre coche dans son espace (user_preferences.abonnements_pro) ce qu'il veut
 * recevoir, et à quel rythme : 'quotidien' | 'hebdo' | 'aucun'. Un seul e-mail par
 * rythme réunit les catégories choisies :
 *   commissions  résumés des auditions et réunions de commission (AN + Sénat)
 *   textes       lois promulguées, projets et propositions de loi déposés
 *   jo           Journal officiel (synthèse de chaque numéro + lois, ordonnances, décrets)
 *   elus         actualités et votes des élus et organisations suivis
 *   amendements_elus  pour chaque élu suivi, ses votes sur les amendements en scrutin public
 *                (nombre, pour / contre / abstention, exemples adoptés d'abord) — 30/10/2026
 *   europe       votes du Parlement européen (et la position des eurodéputés suivis)
 *   territoire   actualités de sa commune, son département, sa région
 *
 * Les informations viennent de ce que le site a déjà publié ; celles des rubriques
 * commissions, textes, JO et Europe sont enrichies par un agent IA (lib/enrichissement-pro :
 * l'essentiel, faits clés, concernés, rapport de force, suite), une fois pour tous.
 * Une information ne part qu'une fois par rythme (table digest_items), même arrivée en
 * base avec retard. S'ajoute à l'alerte « Un texte vous concerne » et au récap du samedi.
 *
 * Envoi : quotidien à 19 h (heure de Paris), hebdomadaire le dimanche à 18 h.
 *   --rythme=quotidien|hebdo   (obligatoire)
 *   --preparer                 enrichit en lot (moitié prix) ce qui partira, n'envoie rien
 *   --test=adresse@exemple.fr  un seul envoi à ce membre, à toute heure, sans journal
 *   --force                    ignore l'heure (rattrapage)
 *   --apercu=fichier.html      écrit l'e-mail du premier destinataire, n'envoie rien
 *   --sans-ia                  aucun appel à l'agent (seulement les enrichissements déjà faits)
 *   --max-ia=N                 au plus N informations enrichies (essais)
 */
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const RYTHME = arg("rythme") as "quotidien" | "hebdo";
const TEST = arg("test");
const APERCU = arg("apercu");
const FORCE = process.argv.includes("--force");
const PREPARER = process.argv.includes("--preparer");
const SANS_IA = process.argv.includes("--sans-ia");
const MAX_IA = Number(arg("max-ia") || 0) || Infinity;
// Plafond de dépense de l'agent par passage (en $) ; le lot du soir coûte moitié moins.
// Plafond d'un passage, en plus du budget mensuel partagé (budget-claude.ts).
const BUDGET_IA = Number(process.env.DIGEST_IA_BUDGET || 2);
const JOUR = 864e5;
const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const CATEGORIES = [
  { code: "commissions", emoji: "🎙️", intitule: "Auditions et commissions", couleur: "#7c3aed" },
  { code: "textes", emoji: "📜", intitule: "Lois et textes déposés", couleur: "#e11d48" },
  { code: "jo", emoji: "📰", intitule: "Journal officiel", couleur: "#0284c7" },
  { code: "elus", emoji: "⭐", intitule: "Vos élus et suivis", couleur: "#d97706" },
  { code: "amendements_elus", emoji: "✍️", intitule: "Votes de vos élus sur les amendements", couleur: "#7c3aed" },
  { code: "europe", emoji: "🇪🇺", intitule: "Votes au Parlement européen", couleur: "#2563eb" },
  { code: "territoire", emoji: "📍", intitule: "Votre territoire", couleur: "#059669" },
] as const;
type Code = typeof CATEGORIES[number]["code"];
// ref : clé de l'enrichissement quand l'information en double une autre (loi du JO = loi promulguée).
type Info = { cle: string; titre: string; resume?: string | null; url?: string | null; etiquette?: string | null; meta?: string | null; importance?: number; ref?: string };
const numeroLoi = (t: string) => /\bn°\s*(\d{4}-\d+)/i.exec(t || "")?.[1];

// Actes de routine du Journal officiel : comptés dans la synthèse, pas listés.
const ROUTINE = /\b(portant|relatif à la|relative à la|relatif aux|relative aux)\s+(nomination|titularisation|d[ée]l[ée]gation de signature|cessation de fonctions|admission|promotion|r[ée]int[ée]gration|d[ée]tachement|mise [àa] disposition|radiation|inscription au tableau)|^(arr[êe]t[ée]|d[ée]cision)\b.*\b(nomination|d[ée]l[ée]gation de signature)/i;

const parisHeure = (d = new Date()) => Number(d.toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Paris" }));
const parisJour = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
const parisJourSemaine = (d = new Date()) => new Date(`${parisJour(d)}T12:00:00Z`).getUTCDay();
const fmtJour = (d: Date | string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });
const fmtCourt = (d: Date | string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });

/* ─────────────── Votes des élus suivis sur les amendements ─────────────── */

const court = (t: string, n: number) => (t.length > n ? `${t.slice(0, t.lastIndexOf(" ", n))}…` : t);
// « l'amendement n° 2121 de Mme Bentorki après l'article 15 du projet de loi… » → l'essentiel.
const objetCourt = (o: string) => court(String(o || "").replace(/^sur\s+/i, "").replace(/\s+(du|de la)\s+(projet|proposition) de loi.*$/i, "").replace(/^./, c => c.toUpperCase()), 120);
const POSITION: Record<string, "pour" | "contre" | "abstention" | "absent"> = { POUR: "pour", FOR: "pour", CONTRE: "contre", AGAINST: "contre", ABSTENTION: "abstention", ABSTAIN: "abstention" };

/**
 * Pour chaque élu suivi (députés et sénateurs), ses votes sur des amendements en scrutin public
 * arrivés depuis `depuis` et pas encore envoyés à ce rythme (clé par élu et par scrutin : un vote
 * relevé avec retard part quand même, et une seule fois). Une ligne par élu.
 */
async function recapAmendementsElus(dIds: string[], sIds: string[], depuis: Date, dejaServi: (cle: string) => boolean) {
  const items: Info[] = []; const cles: string[] = [];
  const ajouter = (nom: string, etiquette: string, url: string, votes: { cle: string; pos: string; objet: string; adopte: boolean }[]) => {
    const neufs = votes.filter(v => !dejaServi(v.cle));
    if (!neufs.length) return;
    const n = (k: string) => neufs.filter(v => v.pos === k).length;
    const exemples = [...neufs].sort((a, b) => Number(b.adopte) - Number(a.adopte)).slice(0, 3)
      .map(v => `${v.objet} — ${v.pos === "absent" ? "non-votant" : v.pos}, ${v.adopte ? "adopté" : "rejeté"}`);
    items.push({ cle: `amdt-recap:${url}:${neufs[0].cle}`, titre: `${nom} : ${neufs.length} vote${neufs.length > 1 ? "s" : ""} sur des amendements`,
      resume: `${n("pour")} pour · ${n("contre")} contre · ${n("abstention")} abstention${n("abstention") > 1 ? "s" : ""}. Dont : ${exemples.join(" ; ")}.`,
      url, etiquette, importance: 3 });
    cles.push(...neufs.map(v => v.cle));
  };
  if (dIds.length) {
    const deputes = (await supabase.from("deputies").select("id, an_id, slug, first_name, last_name, party").in("id", dIds)).data || [];
    const anIds = deputes.map((d: any) => d.an_id).filter(Boolean);
    const votes = anIds.length ? await fetchAll("deputy_votes", "deputy_an_id, scrutin_id, position, scrutins!inner(objet, resultat, type)",
      q => q.in("deputy_an_id", anIds).eq("scrutins.type", "AMENDEMENT").gte("created_at", depuis.toISOString())) : [];
    for (const d of deputes) ajouter(`${d.first_name} ${d.last_name}`, `Député·e${d.party ? ` · ${d.party}` : ""}`, `${SITE_URL}/deputes/${d.slug}/#votes`,
      votes.filter((v: any) => v.deputy_an_id === d.an_id).map((v: any) => ({
        cle: `amdt-vote:${d.an_id}:${v.scrutin_id}`, pos: POSITION[String(v.position).toUpperCase()] || "absent", objet: objetCourt(v.scrutins?.objet),
        adopte: /adopt/i.test(v.scrutins?.resultat || "") && !/n'a pas adopt|pas adopt/i.test(v.scrutins?.resultat || ""),
      })));
  }
  if (sIds.length) {
    const senateurs = (await supabase.from("senators").select("id, senate_matricule, slug, first_name, last_name, party").in("id", sIds)).data || [];
    const mats = senateurs.map((x: any) => x.senate_matricule).filter(Boolean);
    const votes = mats.length ? await fetchAll("legislative_votes", "voter_official_id, position, legislative_scrutins!inner(id, title, for_count, against_count, voted_at, chamber)",
      q => q.in("voter_official_id", mats).eq("legislative_scrutins.chamber", "SENAT").ilike("legislative_scrutins.title", "sur %amendement%").gte("legislative_scrutins.voted_at", depuis.toISOString())) : [];
    for (const x of senateurs) ajouter(`${x.first_name} ${x.last_name}`, `Sénateur·rice${x.party ? ` · ${x.party}` : ""}`, `${SITE_URL}/senateurs/${x.slug}/`,
      votes.filter((v: any) => v.voter_official_id === x.senate_matricule).map((v: any) => ({
        cle: `amdt-vote:${x.senate_matricule}:${v.legislative_scrutins.id}`, pos: POSITION[String(v.position).toUpperCase()] || "absent",
        objet: objetCourt(v.legislative_scrutins.title), adopte: (v.legislative_scrutins.for_count || 0) > (v.legislative_scrutins.against_count || 0),
      })));
  }
  return { items, cles };
}

/* ───────────────────────── Partie commune ───────────────────────── */

async function commun(debut: Date, recul: Date) {
  const depuis = debut.toISOString(); const jourRecul = recul.toISOString().slice(0, 10);

  // Commissions : comptes rendus résumés depuis le dernier envoi (réunions récentes seulement).
  const cr = await fetchAll("commission_reports", "ref, chamber, commission, title, meeting_date, cr_url, summary, updated_at, analyzed_at",
    q => q.gte("meeting_date", jourRecul).not("summary", "is", null));
  const commissions: Info[] = cr.filter((c: any) => (c.analyzed_at || c.updated_at || "") >= depuis)
    .sort((a: any, b: any) => String(b.meeting_date).localeCompare(String(a.meeting_date)))
    .map((c: any) => ({
      cle: `commission:${c.ref}`, titre: c.title, resume: resumeCourt(c.summary, 260), url: c.cr_url,
      etiquette: `${c.chamber === "SENAT" ? "Sénat" : "Assemblée"} · ${c.commission || "Commission"}`,
      meta: `Réunion du ${fmtJour(c.meeting_date)}${/audition/i.test(c.title || "") ? " · audition" : ""}`,
    }));

  // Textes : lois promulguées, puis projets et propositions de loi arrivés sur le site.
  // Promulguées récemment : les rattrapages d'archives (lois de 2022 entrées hier en base) restent dehors.
  const lois = await fetchAll("promulgated_laws", "id, dossier_id, title, promulgated_at, eli_url, created_at", q => q.gte("created_at", depuis).gte("promulgated_at", jourRecul));
  const depots = await fetchAll("legislative_dossiers", "id, title, text_type, author_name, current_chamber, deposited_at, created_at",
    q => q.gte("created_at", depuis).gte("deposited_at", jourRecul).in("text_type", ["bill", "proposal"]));
  const titres = new Map<string, string>();
  const ids = [...new Set([...depots.map((d: any) => String(d.id)), ...lois.filter((l: any) => l.dossier_id).map((l: any) => String(l.dossier_id))])];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from("dossier_display_title").select("dossier_id, display_title").in("dossier_id", ids.slice(i, i + 300));
    for (const t of data || []) titres.set(String(t.dossier_id), t.display_title);
  }
  const textes: Info[] = [
    ...lois.map((l: any) => ({
      cle: `loi:${l.id}`, titre: (l.dossier_id && titres.get(String(l.dossier_id))) || l.title, resume: l.dossier_id ? resumeCourt(l.title, 200) : null,
      url: l.dossier_id ? `${SITE_URL}/lois/?dossier=${l.dossier_id}` : l.eli_url, etiquette: "Loi promulguée", importance: 5,
      meta: l.promulgated_at ? `Promulguée le ${fmtJour(l.promulgated_at)}` : null,
    })),
    // Projets (Gouvernement) avant propositions (parlementaires).
    ...depots.sort((a: any, b: any) => Number(a.text_type !== "bill") - Number(b.text_type !== "bill") || String(b.deposited_at).localeCompare(String(a.deposited_at)))
      .map((d: any) => ({
        cle: `depot:${d.id}`, titre: titres.get(String(d.id)) || d.title, url: `${SITE_URL}/lois/?dossier=${d.id}`, importance: d.text_type === "bill" ? 4 : 3,
        etiquette: `${d.text_type === "bill" ? "Projet de loi" : "Proposition de loi"} · ${d.current_chamber === "SENAT" ? "Sénat" : "Assemblée"}`,
        meta: [d.author_name, d.deposited_at ? `déposée le ${fmtJour(d.deposited_at)}` : null].filter(Boolean).join(" · ") || null,
      })),
  ];

  // Journal officiel : la synthèse de chaque numéro, puis lois, ordonnances et décrets expliqués.
  const editions = await fetchAll("jorf_editions", "date, title, text_count, digest", q => q.gte("date", RYTHME === "quotidien" ? parisJour(debut) : debut.toISOString().slice(0, 10)).not("digest", "is", null));
  editions.sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  const actes = editions.length ? await fetchAll("jorf_texts", "id, edition_date, titre, nature, explication",
    q => q.in("edition_date", editions.map((e: any) => e.date)).in("nature", ["loi", "ordonnance", "decret"]).not("explication", "is", null)) : [];
  const ordreNature = (n: string) => (n === "loi" ? 0 : n === "ordonnance" ? 1 : 2);
  const loiParNumero = new Map(lois.map((l: any) => [numeroLoi(l.title), `loi:${l.id}`]).filter(([n]) => n) as [string, string][]);
  const jo: Info[] = [
    ...editions.map((e: any) => ({
      cle: `jo:${e.date}`, titre: e.title || `Journal officiel du ${fmtJour(e.date)}`, resume: e.digest, url: `${SITE_URL}/premium#journal-officiel`,
      etiquette: `${e.text_count || "?"} textes publiés`, importance: 5,
    })),
    ...actes.filter((a: any) => !ROUTINE.test(a.titre || ""))
      .sort((a: any, b: any) => ordreNature(a.nature) - ordreNature(b.nature) || String(b.edition_date).localeCompare(String(a.edition_date)))
      .map((a: any) => ({
        cle: `jotexte:${a.id}`, titre: a.titre, resume: resumeCourt(a.explication, 200), url: `${SITE_URL}/premium#journal-officiel`,
        etiquette: a.nature === "loi" ? "Loi" : a.nature === "ordonnance" ? "Ordonnance" : "Décret", meta: `JO du ${fmtJour(a.edition_date)}`,
        ref: a.nature === "loi" ? loiParNumero.get(numeroLoi(a.titre) || "") : undefined,
      })),
  ];

  // Parlement européen : un vote par ligne, expliqué en français quand l'explication existe.
  const mv = await fetchAll("mep_votes", "mep_id, vote_id, title, reference, voted_at, position, result, url", q => q.gte("voted_at", recul.toISOString()).eq("is_main", true));
  const votesUE = new Map<string, any>();
  for (const v of mv) if (!votesUE.has(v.vote_id)) votesUE.set(v.vote_id, v);
  const expl = new Map<string, any>();
  const vids = [...votesUE.keys()];
  for (let i = 0; i < vids.length; i += 300) {
    const { data } = await supabase.from("vote_explanations").select("vote_id, title_fr, explanation").in("vote_id", vids.slice(i, i + 300));
    for (const e of data || []) expl.set(e.vote_id, e);
  }
  const europe = [...votesUE.values()].sort((a, b) => String(b.voted_at).localeCompare(String(a.voted_at))).map(v => ({
    vote_id: v.vote_id, cle: `ue:${v.vote_id}`, titre: expl.get(v.vote_id)?.title_fr || v.title, resume: resumeCourt(expl.get(v.vote_id)?.explanation, 220), url: v.url,
    etiquette: v.result === "ADOPTED" ? "Adopté" : v.result === "REJECTED" ? "Rejeté" : "Vote", meta: `${fmtJour(v.voted_at)}${v.reference ? ` · ${v.reference}` : ""}`,
  }));
  const positionsUE = mv; // pour la position des eurodéputés suivis

  // Fils déjà chargés une fois : actualités politiques (la collecte de l'ancien fil de
  // l'accueil) et fils des territoires.
  const actus = await fetchAll("content", "id, titre_simplifie, titre_original, resume_flash, source_url, source_name, date_publication, created_at", q => q.gte("created_at", depuis));
  const fil = await fetchAll("entity_feed", "id, entity_type, entity_id, title, summary, url, published_at, news_type, place, place_scope, created_at",
    q => q.in("entity_type", ["commune", "department", "region"]).gte("created_at", depuis));

  return { commissions, textes, jo, europe, positionsUE, actus, fil };
}

/* ───────────────────────── Ligne enrichie par l'agent ───────────────────────── */

// Analyse complète pour les premières informations de chaque rubrique, l'essentiel ensuite.
const COMPLETES = 6;
const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ligneEnrichie(i: Info, e: Enrichissement, couleur: string, court = false): string {
  const titre = esc(majuscule(resumeCourt(i.titre, 140)));
  const t = i.url ? `<a href="${esc(i.url)}" style="color:${COULEURS.encre};text-decoration:none">${titre}</a>` : titre;
  if (court) e = { ...e, points: [], concernes: "", suite: "", enjeu: "" };
  const rubriqueCourte = (libelle: string, texte: string) => texte
    ? `<div style="font-size:13px;line-height:1.55;color:${COULEURS.doux};margin-top:6px"><span style="font-weight:800;color:${couleur}">${libelle}</span> ${esc(texte)}</div>` : "";
  return `<div style="padding:16px 0;border-bottom:1px solid ${COULEURS.filet}">
  ${i.etiquette ? `<div style="font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${couleur};margin-bottom:4px">${esc(i.etiquette)}</div>` : ""}
  <div style="font-size:15px;line-height:1.4;font-weight:700;color:${COULEURS.encre}">${t}</div>
  <div style="font-size:14px;line-height:1.55;color:${COULEURS.encre};margin-top:6px">${esc(e.essentiel)}</div>
  ${e.points.length ? `<table role="presentation" style="margin-top:6px;border-collapse:collapse">${e.points.map(p => `<tr><td style="vertical-align:top;padding:3px 8px 3px 0;color:${couleur};font-size:13px;line-height:1.5">●</td><td style="padding:3px 0;font-size:13px;line-height:1.5;color:${COULEURS.doux}">${esc(p)}</td></tr>`).join("")}</table>` : ""}
  ${!court && e.amendements?.length ? `<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:#faf8f3;border:1px solid ${COULEURS.filet}">
    <div style="font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${couleur};margin-bottom:4px">Ce que proposaient les amendements</div>
    ${e.amendements.map(a => `<div style="font-size:13px;line-height:1.5;color:${COULEURS.doux};padding:4px 0"><b style="color:${COULEURS.encre}">${esc(a.numero)}</b> · ${esc(a.auteur)} — ${esc(a.objet)}</div>`).join("")}
  </div>` : ""}
  ${e.amendements_texte ? `<div style="margin-top:8px"><a href="${esc(`${SITE_URL}/premium/?amdt-texte=${encodeURIComponent(e.amendements_texte)}#amendements`)}" style="display:inline-block;padding:8px 12px;border-radius:10px;background:${couleur};color:#ffffff;font-size:12px;font-weight:800;text-decoration:none">Lire le texte complet des amendements →</a></div>` : ""}
  ${rubriqueCourte("Qui est concerné ·", e.concernes)}
  ${rubriqueCourte("Rapport de force ·", e.rapport_de_force)}
  ${rubriqueCourte("Et ensuite ·", e.suite)}
  ${rubriqueCourte("L'enjeu ·", e.enjeu)}
  ${i.meta ? `<div style="font-size:11px;color:${COULEURS.pale};margin-top:7px">${esc(i.meta)}</div>` : ""}
</div>`;
}

/* ───────────────────────── Passage ───────────────────────── */

async function main() {
  if (RYTHME !== "quotidien" && RYTHME !== "hebdo") throw new Error("--rythme=quotidien|hebdo");
  const maintenant = new Date();
  const h = parisHeure(maintenant);
  if (PREPARER && !FORCE && h >= 19) { console.log("[Digest] Préparation : l'envoi est déjà parti ou part maintenant, il rattrapera en direct."); return; }
  if (PREPARER && !FORCE && RYTHME === "hebdo" && parisJourSemaine(maintenant) !== 0) { console.log("[Digest] Préparation hebdomadaire : le dimanche seulement."); return; }
  if (!TEST && !APERCU && !FORCE && !PREPARER) {
    // Fenêtre de quelques heures : les crons GitHub partent souvent en retard. Le journal
    // digests_envoyes empêche tout second envoi sur la même période.
    if (RYTHME === "quotidien" && (h < 19 || h > 23)) { console.log(`[Digest] ${h} h à Paris : l'envoi quotidien part à partir de 19 h.`); return; }
    if (RYTHME === "hebdo" && (h < 18 || parisJourSemaine(maintenant) !== 0)) { console.log("[Digest] L'envoi hebdomadaire part le dimanche à partir de 18 h."); return; }
  }
  const duree = RYTHME === "quotidien" ? JOUR : 7 * JOUR;
  const debut = new Date(maintenant.getTime() - duree);
  // Recul : ce qui arrive en base avec retard (comptes rendus, votes européens) reste servi.
  const recul = new Date(maintenant.getTime() - duree - (RYTHME === "quotidien" ? 3 : 7) * JOUR);
  const periode = RYTHME === "quotidien" ? parisJour(maintenant) : parisJour(new Date(maintenant.getTime() - 6 * JOUR));

  // Destinataires : membres Pro ayant choisi au moins une catégorie à ce rythme.
  let pros = (await fetchAll("profiles", "id", q => q.eq("subscription_tier", "pro"))).map((p: any) => p.id);
  if (TEST) {
    let trouve: string | null = null;
    for (let page = 1; page <= 20 && !trouve; page++) {
      const { data: u } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      trouve = ((u?.users || []) as { id: string; email?: string }[]).find(x => (x.email || "").toLowerCase() === TEST.toLowerCase())?.id ?? null;
      if (!u || u.users.length < 1000) break;
    }
    if (!trouve) throw new Error(`Aucun compte pour ${TEST}`);
    pros = [trouve];
  }
  const prefs = new Map((await fetchAll("user_preferences", "user_id, abonnements_pro, city, department, perimetre, jeton_desabo", q => q.in("user_id", pros))).map((p: any) => [p.user_id, p]));
  const choisies = (id: string): Code[] => {
    const a = prefs.get(id)?.abonnements_pro || {};
    // Envoi de test : toutes les catégories, pour voir l'e-mail complet.
    return CATEGORIES.map(c => c.code).filter(c => (TEST && !Object.keys(a).length) || a[c] === RYTHME);
  };
  const deja = TEST || APERCU ? new Set<string>() : new Set((await fetchAll("digests_envoyes", "user_id", q => q.eq("rythme", RYTHME).eq("periode", periode))).map((r: any) => r.user_id));
  const destinataires = pros.filter(id => choisies(id).length && !deja.has(id));
  console.log(`[Digest ${RYTHME}] ${destinataires.length} destinataire(s) sur ${pros.length} membre(s) Pro.`);
  if (!destinataires.length) return;

  const c = await commun(debut, recul);
  const servis = new Set((await fetchAll("digest_items", "cle", q => q.eq("rythme", RYTHME).gte("envoye_le", new Date(recul.getTime() - 14 * JOUR).toISOString()))).map((r: any) => r.cle));
  const neuf = <T extends Info>(l: T[]) => TEST || APERCU ? l : l.filter(i => !servis.has(i.cle));
  console.log(`[Digest ${RYTHME}] ${c.commissions.length} commission(s), ${c.textes.length} texte(s), ${c.jo.length} ligne(s) JO, ${c.europe.length} vote(s) UE, ${c.actus.length} actu(s), ${c.fil.length} info(s) locale(s).`);

  const plafond = RYTHME === "quotidien" ? 12 : 20;
  // Un même fait n'apparaît qu'une fois dans une rubrique.
  const unique = <T extends Info>(l: T[]) => { const vus = new Set<string>(); return l.filter(i => i.titre && !vus.has(norm(i.titre).slice(0, 70)) && !!vus.add(norm(i.titre).slice(0, 70))); };

  // Rubriques communes à tous : l'agent enrichit une fois ce qui partira (en lot une heure
  // avant l'envoi, en direct pour ce qui est arrivé depuis), pour tous les membres.
  const partagees: [Code, Info[]][] = [["commissions", c.commissions], ["textes", c.textes], ["jo", c.jo.filter(i => !i.cle.startsWith("jo:"))], ["europe", c.europe]];
  const voulues = new Set(destinataires.flatMap(choisies));
  // Entrelacées (1re commission, 1er texte, 1er acte, 1er vote UE, puis les 2es…) : le budget
  // du jour (20 $ par mois pour tout Claude) bénéficie ainsi à chaque rubrique, au lieu d'être
  // épuisé par la première.
  const listes = partagees.filter(([k]) => voulues.has(k)).map(([, l]) => unique(neuf(l)).slice(0, plafond));
  const aEnrichir = Array.from({ length: Math.max(0, ...listes.map(l => l.length)) }, (_, n) => listes.map(l => l[n]).filter(Boolean)).flat()
    .map(i => (i.ref ? { ...i, cle: i.ref } : i)).slice(0, MAX_IA);
  const enr = await lireEnrichissements(aEnrichir.map(i => i.cle));
  if (!SANS_IA) for (const [k, v] of await enrichir(aEnrichir.filter(i => !enr.has(i.cle)), { mode: PREPARER ? "lot" : "direct", budget: BUDGET_IA })) enr.set(k, v);
  if (PREPARER) { console.log(`[Digest ${RYTHME}] Préparation faite : ${enr.size}/${aEnrichir.length} information(s) enrichie(s).`); return; }

  const adresses = await adressesDesMembres(destinataires);
  const { data: profils } = await supabase.from("profiles").select("id, display_name").in("id", destinataires);
  const prenom = new Map((profils || []).map((p: any) => [p.id, (p.display_name || "").split(" ")[0]]));
  const aServir = new Set<string>();
  let envoyes = 0;

  for (const id of destinataires) {
    const p = prefs.get(id) || {};
    const cats = choisies(id);
    const blocs: string[] = []; const resume: string[] = []; let total = 0;
    const desabo = (code: string) => p.jeton_desabo ? `${SITE_URL}/desabonnement/?t=${p.jeton_desabo}&c=${code}` : `${SITE_URL}/premium#preferences`;

    for (const cat of CATEGORIES.filter(x => cats.includes(x.code))) {
      let items: Info[] = []; let note: string | undefined; let vide = "Rien de nouveau sur cette période.";
      if (cat.code === "commissions") items = neuf(c.commissions);
      if (cat.code === "textes") items = neuf(c.textes);
      // La loi du JO est déjà dans « Lois et textes » quand le membre a choisi les deux.
      if (cat.code === "jo") items = neuf(c.jo).filter(i => !(i.ref && cats.includes("textes")));
      if (cat.code === "europe") {
        // Position des eurodéputés suivis, vote par vote.
        const { data: f } = await supabase.from("user_follows").select("mep_id").eq("user_id", id).not("mep_id", "is", null);
        const suivis = new Set((f || []).map((x: any) => String(x.mep_id)));
        const noms = suivis.size ? new Map(((await supabase.from("meps").select("id, full_name").in("id", [...suivis])).data || []).map((m: any) => [String(m.id), m.full_name])) : new Map();
        items = neuf(c.europe).map(v => {
          const pos = c.positionsUE.filter((m: any) => m.vote_id === v.vote_id && suivis.has(String(m.mep_id))).map((m: any) => `${noms.get(String(m.mep_id)) || "Votre eurodéputé"} : ${String(m.position || "absent").toLowerCase()}`);
          return pos.length ? { ...v, meta: `${v.meta} · ${pos.join(" · ")}` } : v;
        });
      }
      if (cat.code === "elus") {
        // Alertes déjà calculées pour ce membre (votes de ses élus, suivis), puis l'actualité
        // politique qui les nomme en toutes lettres (prénom + nom : pas de faux positif sur un nom court).
        const { data: notifs } = await supabase.from("user_notifications").select("id, title, detail, url, domain, position, importance, categorie")
          .eq("user_id", id).in("categorie", ["votes", "suivis"]).gte("created_at", debut.toISOString()).order("importance", { ascending: false }).limit(60);
        const { data: f } = await supabase.from("user_follows").select("deputy_id, senator_id").eq("user_id", id);
        const dIds = (f || []).map((x: any) => x.deputy_id).filter(Boolean); const sIds = (f || []).map((x: any) => x.senator_id).filter(Boolean);
        const personnes = [
          ...(dIds.length ? (await supabase.from("deputies").select("first_name, last_name").in("id", dIds)).data || [] : []),
          ...(sIds.length ? (await supabase.from("senators").select("first_name, last_name").in("id", sIds)).data || [] : []),
        ].map((x: any) => `${x.first_name} ${x.last_name}`).filter(n => n.length > 6);
        const actus = c.actus.filter((a: any) => personnes.some(n => norm(`${a.titre_simplifie || ""} ${a.resume_flash || ""} ${a.titre_original || ""}`).includes(norm(n))))
          .map((a: any) => ({ cle: `actu:${a.id}`, titre: a.titre_simplifie || a.titre_original, resume: resumeCourt(a.resume_flash, 200), url: a.source_url,
            etiquette: personnes.find(n => norm(`${a.titre_simplifie || ""} ${a.resume_flash || ""} ${a.titre_original || ""}`).includes(norm(n))) || null, meta: a.source_name }));
        items = [
          ...(notifs || []).map((n: any) => ({ cle: `notif:${n.id}`, titre: n.detail && n.categorie === "votes" ? n.detail : n.title, resume: n.categorie === "votes" ? n.title : resumeCourt(n.detail, 200),
            url: n.url, etiquette: n.position ? `Vote : ${n.position}` : n.domain, importance: n.importance ?? 3 })),
          ...actus,
        ];
        if (!dIds.length && !sIds.length && !(notifs || []).length) vide = "Vous ne suivez encore aucun élu : ajoutez-en depuis leur fiche (bouton « Suivre »).";
      }
      if (cat.code === "amendements_elus") {
        const { data: f } = await supabase.from("user_follows").select("deputy_id, senator_id").eq("user_id", id);
        const dIds = (f || []).map((x: any) => x.deputy_id).filter(Boolean); const sIds = (f || []).map((x: any) => x.senator_id).filter(Boolean);
        if (!dIds.length && !sIds.length) vide = "Vous ne suivez encore aucun élu : ajoutez-en depuis leur fiche (bouton « Suivre »).";
        else {
          const r = await recapAmendementsElus(dIds, sIds, recul, cle => !TEST && !APERCU && servis.has(cle));
          items = r.items;
          r.cles.forEach(k => aServir.add(k));
          if (!items.length) vide = "Aucun vote de vos élus sur un amendement en scrutin public sur cette période (les amendements votés à main levée n'ont pas de décompte par élu).";
        }
      }
      if (cat.code === "territoire") {
        const loc = await resolveLocation(p.city || null, p.department || null);
        const perimetre = !p.perimetre || p.perimetre === "national" ? "departement" : p.perimetre;
        if (!loc.communeCode && !loc.deptCode) vide = "Indiquez votre commune dans vos préférences pour recevoir cette rubrique.";
        else items = neuf(c.fil.filter((f: any) =>
          (f.entity_type === "commune" && String(f.entity_id) === loc.communeCode)
          || (perimetre !== "commune" && f.entity_type === "department" && String(f.entity_id) === loc.deptCode && f.place_scope !== "commune")
          || (perimetre === "region" && f.entity_type === "region" && String(f.entity_id) === loc.regionCode))
          .sort((a: any, b: any) => Number(b.entity_type === "commune") - Number(a.entity_type === "commune") || importanceOf(b.news_type) - importanceOf(a.news_type))
          .map((f: any) => ({ cle: `feed:${f.id}`, titre: f.title, resume: resumeCourt(f.summary, 200), url: f.url, etiquette: f.place || null, meta: fmtCourt(f.published_at) })));
        if (p.city) note = `${p.city} · périmètre : ${perimetre === "commune" ? "commune" : perimetre === "region" ? "région" : "département"}`;
      }

      items = unique(items);
      const montres = items.slice(0, plafond);
      montres.forEach(i => aServir.add(`${i.cle}`));
      total += montres.length;
      if (montres.length) resume.push(`${montres.length} ${cat.intitule.toLowerCase()}`);
      const corps = montres.length
        ? montres.map((i, n) => enr.has(i.ref || i.cle) ? ligneEnrichie(i, enr.get(i.ref || i.cle)!, cat.couleur, n >= COMPLETES)
          : ligne({ titre: majuscule(resumeCourt(i.titre, 140)), url: i.url, resume: i.resume, etiquette: i.etiquette, couleur: cat.couleur, meta: i.meta })).join("")
          + (items.length > plafond ? `<div style="padding:10px 0;font-size:12px;color:${COULEURS.doux}">… et ${items.length - plafond} autre${items.length - plafond > 1 ? "s" : ""} dans votre espace Pro.</div>` : "")
        : `<div style="padding:12px 0;font-size:13px;color:${COULEURS.pale}">${esc(vide)}</div>`;
      blocs.push(rubrique(cat.emoji, cat.intitule, cat.couleur, corps + `<div style="padding-top:6px;font-size:11px"><a href="${esc(desabo(cat.code))}" style="color:${COULEURS.pale}">Ne plus recevoir cette rubrique</a></div>`, note));
    }

    // Rien de neuf dans aucune des rubriques choisies : pas d'e-mail vide.
    if (!total && !TEST && !APERCU) { console.log(`[Digest ${RYTHME}] ${id.slice(0, 8)} : rien de neuf, pas d'envoi.`); continue; }
    const quotidien = RYTHME === "quotidien";
    const html = gabarit({
      preheader: resume.join(" · ") || "Votre sélection Pro",
      surtitre: quotidien ? `Pro · ${fmtJour(maintenant)}` : `Pro · semaine du ${fmtJour(debut)}`,
      titre: quotidien ? "Votre journée <span style=\"color:#fbbf24\">politique</span>" : "Votre semaine <span style=\"color:#fbbf24\">politique</span>",
      sousTitre: `${prenom.get(id) ? `Bonjour ${esc(prenom.get(id))} — ` : ""}les rubriques que vous avez choisies${quotidien ? ", depuis hier 19 h" : ", sur les sept derniers jours"}.`,
      corps: blocs.join("") + bouton("Ouvrir mon espace Pro", `${SITE_URL}/premium`, "#b45309"),
      pied: `${enr.size ? "Les analyses sous chaque titre sont rédigées par une IA (Claude) à partir des textes officiels, des votes et des comptes rendus : vérifiez la source avant de citer.<br><br>" : ""}Vous recevez cet e-mail car vous êtes membre Pro et l'avez demandé ${quotidien ? "chaque jour" : "chaque semaine"}.<br>
        <a href="${SITE_URL}/premium#preferences" style="color:#64748b">Choisir mes rubriques</a> · <a href="${esc(desabo("tout"))}" style="color:#64748b">Ne plus rien recevoir de ces e-mails</a>`,
    });
    if (APERCU) { const fs = await import("node:fs"); fs.writeFileSync(APERCU, html); console.log(`[Digest] Aperçu écrit : ${APERCU} (${total} ligne(s)).`); return; }
    const adresse = adresses.get(id);
    if (!adresse) continue;
    const sujet = `${quotidien ? "Votre journée" : "Votre semaine"} politique — ${resume.slice(0, 3).join(", ") || "votre sélection Pro"}`;
    if (await envoyerMail(adresse, sujet.slice(0, 140), html, { desabo: desabo("tout") })) {
      envoyes++;
      if (!TEST && !simulation) await supabase.from("digests_envoyes").upsert({ user_id: id, rythme: RYTHME, periode, nb_items: total }, { onConflict: "user_id,rythme,periode" });
    }
    await new Promise(r => setTimeout(r, 600));
  }

  // Ce qui est parti ne repartira pas au même rythme.
  if (!TEST && !APERCU && !simulation && aServir.size) {
    const lignes = [...aServir].map(cle => ({ rythme: RYTHME, cle }));
    for (let i = 0; i < lignes.length; i += 500) await supabase.from("digest_items").upsert(lignes.slice(i, i + 500), { onConflict: "rythme,cle", ignoreDuplicates: true });
  }
  console.log(`[Digest ${RYTHME}] ${envoyes} e-mail(s) envoyé(s)${simulation ? " — SIMULATION" : ""}.`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
