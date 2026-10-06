import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { matchDomains, INTEREST_DOMAINS } from "../../lib/interest-domains.js";
import { fetchAll, resolveLocation, withImplied, importanceOf } from "./generate-interest-notifications.js";
import { envoyerMail, adressesDesMembres, gabarit, rubrique, ligne, bouton, esc, resumeCourt, SITE_URL, COULEURS, simulation } from "../../lib/mail.js";

/**
 * « La semaine politique en 5 minutes » — récap du samedi pour les membres Pro.
 *
 * Partie commune (calculée une fois) : un édito rédigé par l'IA à partir de ce que
 * le site a publié dans la semaine, puis Parlement (lois, Assemblée, Sénat),
 * exécutif et présidentielle. Partie personnelle, sans IA : les votes de ses élus,
 * ses suivis (partis, ministères, candidats, commissions), son territoire et ses
 * centres d'intérêt, d'après son profil.
 *
 * Envoi : samedi à 8 h, heure de Paris (le cron passe à 6 h et 7 h UTC, le script
 * ne part qu'à 8 h locales — été comme hiver). Un récap par membre et par semaine
 * (table recaps_envoyes).
 *
 *   --test=adresse@exemple.fr  : un seul envoi, à ce membre, à toute heure, sans journal
 *   --force                    : ignore l'heure (rattrapage)
 *   --apercu=fichier.html      : écrit l'e-mail du premier membre dans un fichier, n'envoie rien
 */
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const TEST = arg("test");
const APERCU = arg("apercu");
const FORCE = process.argv.includes("--force");
const JOUR = 86400000;
const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const labelDomaine = (c: string) => INTEREST_DOMAINS.find(d => d.code === c)?.label || c;

// Actes de routine (nominations, titularisations, délégations) : comptés, pas listés.
const ROUTINE = /^(nomination|titularisation|d[ée]l[ée]gation de signature|cessation de fonctions|admission|promotion|r[ée]int[ée]gration|d[ée]tachement|mise [àa] disposition|portant nomination)/i;

type Info = { titre: string; resume: string | null; url: string | null; date: string | null; source: string; importance: number; chambre?: string | null; etiquette?: string | null };

/* ───────────────────────── Partie commune ───────────────────────── */

async function semaine(depuis: string) {
  const jour = depuis.slice(0, 10);
  const [dossiers, scrutins, comptesRendus, ministeres, decrets, actus, sondages, candidats] = await Promise.all([
    fetchAll("legislative_dossiers", "id, title, status_code, status_label, current_chamber, latest_step_at", q => q.gte("latest_step_at", depuis)),
    fetchAll("legislative_scrutins", "chamber, title, result_label, for_count, against_count, voted_at, source_url", q => q.gte("voted_at", depuis)),
    fetchAll("commission_reports", "chamber, commission, title, summary, cr_url, meeting_date, word_count", q => q.gte("meeting_date", jour)),
    fetchAll("entity_feed", "entity_id, title, summary, url, published_at, news_type", q => q.eq("entity_type", "ministry").gte("published_at", depuis)),
    fetchAll("decrees", "title, display_title, summary, source_url, date_publi, nature", q => q.gte("date_publi", jour)),
    fetchAll("content", "titre_simplifie, titre_original, resume_flash, source_url, institution, date_publication, source_name", q => q.gte("created_at", depuis)),
    fetchAll("sondages", "institut, date_fin, hypothese, resultats, tour", q => q.eq("tour", 1).gte("date_fin", jour)),
    fetchAll("candidate_news", "title, summary, source_url, date, news_type", q => q.gte("date", jour)),
  ]);
  // Nom lisible d'un ministère (le fil ne porte qu'un identifiant : « ministere-de-l-interieur »).
  const slug = (t: string) => norm(t).replace(/[’']/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const nomsMinisteres = new Map((await fetchAll("ministries", "name", q => q)).map((m: any) => [slug(m.name), m.name.charAt(0).toUpperCase() + m.name.slice(1)]));
  const titres = new Map<string, string>();
  if (dossiers.length) {
    const { data } = await supabase.from("dossier_display_title").select("dossier_id, display_title").in("dossier_id", dossiers.map((d: any) => String(d.id)));
    for (const t of data || []) titres.set(t.dossier_id, t.display_title);
  }
  const dossier = (d: any): Info => ({
    titre: titres.get(String(d.id)) || d.title, resume: d.status_label || null, url: `${SITE_URL}/lois/?dossier=${d.id}`,
    date: d.latest_step_at, source: "dossier", importance: /promulg|adopt|vot/.test(d.status_code || "") ? 5 : 3, chambre: d.current_chamber,
  });
  const ordreStatut = (s: string) => (/promulg/.test(s) ? 0 : /adopt|voted/.test(s) ? 1 : /public_debate/.test(s) ? 2 : /committee/.test(s) ? 3 : 4);
  const trie = (l: any[]) => [...l].sort((a, b) => ordreStatut(a.status_code || "") - ordreStatut(b.status_code || "") || String(b.latest_step_at).localeCompare(String(a.latest_step_at)));

  const lois = trie(dossiers.filter((d: any) => /promulg|adopt|voted/.test(d.status_code || ""))).map(dossier);
  const parChambre = (ch: string) => ({
    textes: trie(dossiers.filter((d: any) => d.current_chamber === ch && /public_debate|committee/.test(d.status_code || ""))).slice(0, 3).map(dossier),
    votes: scrutins.filter((s: any) => s.chamber === ch).slice(0, 3).map((s: any): Info => ({
      titre: s.title, resume: s.result_label ? `${s.result_label}${s.for_count != null ? ` — ${s.for_count} pour, ${s.against_count} contre` : ""}` : null,
      url: s.source_url, date: s.voted_at, source: "scrutin", importance: 4, chambre: ch,
    })),
    commissions: comptesRendus.filter((c: any) => c.chamber === ch && c.summary).sort((a: any, b: any) => (b.word_count || 0) - (a.word_count || 0)).slice(0, 2)
      .map((c: any): Info => ({ titre: c.title, resume: c.summary, url: c.cr_url, date: c.meeting_date, source: "commission", importance: 3, etiquette: c.commission })),
    nbCommissions: comptesRendus.filter((c: any) => c.chamber === ch).length,
  });
  const executif = [
    ...ministeres.map((m: any): Info => ({ titre: m.title, resume: m.summary, url: m.url, date: m.published_at, source: "ministere", importance: importanceOf(m.news_type), etiquette: nomsMinisteres.get(m.entity_id) || "Gouvernement" })),
  ].filter(i => !ROUTINE.test(i.titre)).sort((a, b) => b.importance - a.importance).slice(0, 4);
  const decretsNotables = decrets.filter((d: any) => d.summary && !ROUTINE.test(d.display_title || d.title)).slice(0, 3)
    .map((d: any): Info => ({ titre: d.display_title || d.title, resume: d.summary, url: d.source_url, date: d.date_publi, source: "decret", importance: 4, etiquette: "Journal officiel" }));
  const actualites = actus.filter((a: any) => a.titre_simplifie || a.titre_original)
    .map((a: any): Info => ({ titre: a.titre_simplifie || a.titre_original, resume: a.resume_flash, url: a.source_url, date: a.date_publication, source: "actu", importance: 3, etiquette: a.institution || a.source_name }));

  // Présidentielle : le dernier sondage de la semaine, hypothèse 1.
  const dernierSondage = [...sondages].sort((a: any, b: any) => String(b.date_fin).localeCompare(String(a.date_fin)) || a.hypothese - b.hypothese)[0];
  const nbSondages = new Set(sondages.map((s: any) => `${s.institut}|${s.date_fin}`)).size;

  return { lois, an: parChambre("AN"), senat: parChambre("SENAT"), executif, decretsNotables, nbDecrets: decrets.length,
    actualites, dernierSondage, nbSondages, candidats,
    // Réservoir pour les centres d'intérêt de chacun.
    // Réservoir des centres d'intérêt : hors textes de loi, déjà dans « Au Parlement ».
    reservoir: [...actualites, ...executif, ...decretsNotables] };
}

/** Édito commun : l'IA gratuite, et en secours (un seul appel par semaine) DeepSeek payant. */
async function edito(s: Awaited<ReturnType<typeof semaine>>): Promise<{ accroche: string; edito: string; a_retenir: string[] } | null> {
  const lignes = [
    ...s.lois.slice(0, 6).map(l => `[Loi] ${l.titre} (${l.resume || ""})`),
    ...[...s.an.textes, ...s.an.votes].map(l => `[Assemblée] ${l.titre}`),
    ...[...s.senat.textes, ...s.senat.votes].map(l => `[Sénat] ${l.titre}`),
    ...s.executif.map(l => `[Exécutif] ${l.titre}`),
    ...s.actualites.slice(0, 18).map(l => `[Actu] ${l.titre}${l.resume ? ` — ${resumeCourt(l.resume, 140)}` : ""}`),
    ...(s.dernierSondage ? [`[Sondage] ${s.dernierSondage.institut} : ${(s.dernierSondage.resultats as any[]).slice(0, 3).map(r => `${r.nom} ${r.pct} %`).join(", ")}`] : []),
  ];
  if (lignes.length < 3) return null;
  const params = {
    model: "deepseek-chat", max_tokens: 3000, responseFormat: "json_object" as const, sansReflexion: true,
    system: `Tu rédiges l'édito d'une lettre d'information civique hebdomadaire, « La semaine politique en 5 minutes », pour un site neutre et non partisan.
À partir UNIQUEMENT des éléments fournis (publiés cette semaine sur le site), écris :
- "accroche" : une phrase-titre de 6 à 12 mots résumant la semaine ;
- "edito" : 70 à 110 mots, clairs et vivants, factuels, sans opinion ni adjectif de jugement, qui relient les faits marquants ;
- "a_retenir" : 3 à 5 points très courts (12 mots max chacun), les faits les plus importants.
N'invente rien. Si un élément est incertain, ne le cite pas. Réponds en JSON : {"accroche":"…","edito":"…","a_retenir":["…"]}`,
    messages: [{ role: "user" as const, content: lignes.join("\n") }],
  };
  const lire = (r: any) => { const t = r.content?.[0]?.text ?? ""; const m = t.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; };
  try { return lire(await resilientDeepSeek.createMessage(params, { timeoutMs: 90000 })); }
  catch (e: any) {
    console.warn(`[Récap] édito gratuit impossible (${e.message}) — secours payant.`);
    try { return lire(await resilientDeepSeek.createMessage(params, { timeoutMs: 90000, payant: true })); }
    catch (e2: any) { console.warn(`[Récap] pas d'édito cette semaine : ${e2.message}`); return null; }
  }
}

/* ───────────────────────── E-mail ───────────────────────── */

const fmtJour = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });

function composer(commun: Awaited<ReturnType<typeof semaine>>, ed: Awaited<ReturnType<typeof edito>>, perso: {
  prenom: string; votes: any[]; suivis: any[]; local: Info[]; sujets: (Info & { domaine: string })[]; lieu: string | null; demo: boolean; jeton: string | null;
}, debut: Date, fin: Date) {
  const blocs: string[] = [];
  const mots = (s: string) => s.split(/\s+/).length;
  let lecture = 0;
  const lignes = (l: Info[], couleur: string) => { const vus = new Set<string>(); const h = l.filter(i => { const k = norm(i.titre).slice(0, 70); return !vus.has(k) && !!vus.add(k); }).map(i => ligne({ titre: resumeCourt(i.titre, 115), url: i.url, resume: resumeCourt(i.resume, 170), etiquette: i.etiquette, couleur })).join(""); lecture += mots(h.replace(/<[^>]+>/g, " ")); return h; };

  if (perso.demo) blocs.push(`<div style="margin-top:20px;padding:12px 14px;border-radius:12px;background:#fef3c7;font-size:12px;color:#92400e">Envoi de test : profil de démonstration (Paris, économie, sécurité, santé). Renseignez votre profil pour un récap à votre mesure.</div>`);

  // L'essentiel
  if (ed) {
    lecture += mots(ed.edito);
    blocs.push(`<div style="margin-top:26px">
      <div style="font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#7c3aed">L'essentiel</div>
      <div style="font-size:22px;line-height:1.25;font-weight:800;color:${COULEURS.encre};margin-top:8px">${esc(ed.accroche)}</div>
      <div style="font-size:15px;line-height:1.65;color:#334155;margin-top:10px">${esc(ed.edito)}</div>
      ${ed.a_retenir?.length ? `<div style="margin-top:16px;padding:16px 18px;border-radius:16px;background:#f5f3ff">
        <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#6d28d9;margin-bottom:6px">À retenir</div>
        ${ed.a_retenir.slice(0, 5).map(p => `<div style="font-size:14px;line-height:1.5;color:${COULEURS.encre};padding:4px 0">▸ ${esc(p)}</div>`).join("")}
      </div>` : ""}
    </div>`);
  }

  // Pour vous
  const perso_: string[] = [];
  if (perso.votes.length) perso_.push(rubrique("🗳️", "Vos élus ont voté", "#4f46e5", perso.votes.slice(0, 6).map(v =>
    ligne({ titre: v.detail || v.title, url: v.url, resume: v.detail ? v.title : null, etiquette: v.position ? `Vote : ${v.position}` : null,
      couleur: v.position === "POUR" ? "#059669" : v.position === "CONTRE" ? "#e11d48" : "#d97706" })).join("")));
  if (perso.suivis.length) perso_.push(rubrique("⭐", "Ce que vous suivez", "#d97706", perso.suivis.slice(0, 6).map(s =>
    ligne({ titre: s.title, url: s.url, resume: resumeCourt(s.detail, 150), etiquette: s.domain, couleur: "#b45309" })).join("")));
  if (perso.local.length) perso_.push(rubrique("📍", perso.lieu ? `Près de chez vous · ${perso.lieu}` : "Près de chez vous", "#e11d48", lignes(perso.local, "#e11d48")));
  if (perso.sujets.length) perso_.push(rubrique("🎯", "Vos sujets", "#0891b2", perso.sujets.map(i =>
    ligne({ titre: i.titre, url: i.url, resume: resumeCourt(i.resume, 150), etiquette: labelDomaine(i.domaine), couleur: "#0e7490" })).join("")));
  if (perso_.length) blocs.push(`<div style="margin-top:34px;font-family:'Staatliches',Impact,'Arial Narrow Bold',sans-serif;font-size:26px;text-transform:uppercase;color:${COULEURS.encre}">Pour vous</div>`, ...perso_);

  // Au Parlement
  const parlement: string[] = [];
  if (commun.lois.length) parlement.push(rubrique("📜", "Textes adoptés", "#059669", lignes(commun.lois.slice(0, 4), "#059669")));
  for (const [ch, nom, couleur] of [["an", "Assemblée nationale", "#2563eb"], ["senat", "Sénat", "#dc2626"]] as const) {
    const c = commun[ch];
    const contenu = lignes([...c.votes, ...c.textes, ...c.commissions].slice(0, 4), couleur);
    if (contenu) parlement.push(rubrique(ch === "an" ? "🏛️" : "⚖️", nom, couleur, contenu, c.nbCommissions ? `${c.nbCommissions} réunion${c.nbCommissions > 1 ? "s" : ""} de commission analysée${c.nbCommissions > 1 ? "s" : ""} cette semaine` : undefined));
  }
  if (parlement.length) blocs.push(`<div style="margin-top:34px;font-family:'Staatliches',Impact,'Arial Narrow Bold',sans-serif;font-size:26px;text-transform:uppercase;color:${COULEURS.encre}">Au Parlement</div>`, ...parlement);

  // Exécutif
  const exe = [...commun.executif, ...commun.decretsNotables].slice(0, 5);
  if (exe.length) blocs.push(rubrique("🏢", "Gouvernement et Journal officiel", "#7c3aed", lignes(exe, "#7c3aed"),
    commun.nbDecrets ? `${commun.nbDecrets} décret${commun.nbDecrets > 1 ? "s" : ""} publié${commun.nbDecrets > 1 ? "s" : ""} au Journal officiel cette semaine` : undefined));

  // Présidentielle
  if (commun.dernierSondage) {
    const r = (commun.dernierSondage.resultats as any[]).slice(0, 4);
    const max = Math.max(...r.map(x => x.pct));
    const barres = r.map(x => `<tr><td style="width:120px;font-size:13px;font-weight:700;color:${COULEURS.encre};padding:4px 0">${esc(x.nom)}</td>
      <td style="padding:4px 8px"><div style="height:10px;border-radius:6px;background:#e2e8f0"><div style="height:10px;border-radius:6px;background:#4f46e5;width:${Math.round((x.pct / max) * 100)}%"></div></div></td>
      <td style="width:48px;text-align:right;font-size:13px;font-weight:800;color:${COULEURS.encre}">${String(x.pct).replace(".", ",")} %</td></tr>`).join("");
    blocs.push(rubrique("📊", "Présidentielle 2027", "#4f46e5", `<div style="padding:12px 0">
      <div style="font-size:13px;color:${COULEURS.doux};margin-bottom:8px">Dernier sondage : <strong style="color:${COULEURS.encre}">${esc(commun.dernierSondage.institut)}</strong>${commun.nbSondages > 1 ? ` — ${commun.nbSondages} sondages publiés cette semaine` : ""}</div>
      <table role="presentation" width="100%">${barres}</table>
      <div style="margin-top:8px"><a href="${SITE_URL}/presidentielles-2027/#sondages" style="font-size:12px;font-weight:800;color:#4f46e5;text-decoration:none">Tous les sondages et leur moyenne →</a></div>
    </div>`));
  }

  // Le fil de la semaine (si la place le permet)
  if (commun.actualites.length && lecture < 650) blocs.push(rubrique("📰", "Aussi cette semaine", "#475569", lignes(commun.actualites.slice(0, 4), "#475569")));

  const minutes = Math.max(3, Math.min(6, Math.round(lecture / 200)));
  const desabo = perso.jeton ? `${SITE_URL}/desabonnement/?t=${perso.jeton}` : `${SITE_URL}/dashboard#preferences`;
  const html = gabarit({
    preheader: ed?.accroche || "Ce qu'il faut retenir de la semaine politique.",
    surtitre: `Semaine du ${fmtJour(debut)} au ${fmtJour(fin)}`,
    titre: "La semaine politique <span style=\"color:#a78bfa\">en 5 minutes</span>",
    sousTitre: `${perso.prenom ? `Bonjour ${esc(perso.prenom)} — ` : ""}lecture : ${minutes} min · sélectionné pour vous d'après votre profil.`,
    corps: blocs.join("") + bouton("Ouvrir mon espace", `${SITE_URL}/dashboard`, "#7c3aed"),
    pied: `Vous recevez ce récap car vous êtes membre Pro de La Politique C'est Simple.<br>
      <a href="${SITE_URL}/dashboard#preferences" style="color:#64748b">Personnaliser mes alertes</a> · <a href="${desabo}" style="color:#64748b">Ne plus recevoir le récap</a>`,
  });
  return { html, desabo, minutes };
}

/* ───────────────────────── Passage ───────────────────────── */

async function main() {
  const heureParis = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Paris" }));
  if (!TEST && !APERCU && !FORCE && heureParis !== 8) { console.log(`[Récap] Il est ${heureParis} h à Paris : envoi à 8 h seulement.`); return; }

  const fin = new Date(); const debut = new Date(fin.getTime() - 7 * JOUR);
  const samedi = fin.toISOString().slice(0, 10);

  // Destinataires : membres Pro (ou le membre de test).
  let ids: string[];
  if (TEST) {
    let trouve: string | null = null;
    for (let page = 1; page <= 20 && !trouve; page++) {
      const { data: u } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      const membres = (u?.users || []) as { id: string; email?: string }[];
      trouve = membres.find(x => (x.email || "").toLowerCase() === TEST.toLowerCase())?.id ?? null;
      if (!u || u.users.length < 1000) break;
    }
    if (!trouve) throw new Error(`Aucun compte pour ${TEST}`);
    ids = [trouve];
  } else {
    ids = (await fetchAll("profiles", "id", q => q.eq("subscription_tier", "pro"))).map((p: any) => p.id);
  }
  const prefs = new Map((await fetchAll("user_preferences", "user_id, interests, region, department, city, age_range, profession, perimetre, recap_hebdo, jeton_desabo", q => q.in("user_id", ids))).map((p: any) => [p.user_id, p]));
  const deja = TEST || APERCU ? new Set<string>() : new Set((await fetchAll("recaps_envoyes", "user_id", q => q.eq("semaine", samedi))).map((r: any) => r.user_id));
  const destinataires = ids.filter(id => (prefs.get(id)?.recap_hebdo ?? true) && !deja.has(id));
  console.log(`[Récap] ${destinataires.length} destinataire(s) (${ids.length} membre(s) Pro, ${deja.size} déjà servi(s)).`);
  if (!destinataires.length) return;

  const commun = await semaine(debut.toISOString());
  console.log(`[Récap] Semaine : ${commun.lois.length} texte(s) adopté(s), ${commun.actualites.length} actu(s), ${commun.executif.length} info(s) exécutif, ${commun.nbSondages} sondage(s).`);
  const ed = await edito(commun);
  const adresses = await adressesDesMembres(destinataires);
  const { data: profils } = await supabase.from("profiles").select("id, display_name").in("id", destinataires);
  const prenom = new Map((profils || []).map((p: any) => [p.id, (p.display_name || "").split(" ")[0]]));

  // Fil local de la semaine, chargé une fois.
  const fil = await fetchAll("entity_feed", "entity_type, entity_id, title, summary, url, published_at, news_type, place, place_scope",
    q => q.in("entity_type", ["commune", "department", "region"]).gte("published_at", debut.toISOString()));

  let envoyes = 0;
  for (const id of destinataires) {
    let p = prefs.get(id); let demo = false;
    if (TEST && !p?.city && !p?.department && !(p?.interests || []).length) {
      p = { ...p, city: "Paris", department: "75", interests: ["economie", "securite", "sante"], perimetre: "departement" }; demo = true;
    }
    const loc = await resolveLocation(p?.city || null, p?.department || null);
    const interets = withImplied(p?.interests || [], p?.profession || null, p?.age_range || null);
    const { data: notifs } = await supabase.from("user_notifications").select("id, type, categorie, title, detail, position, domain, url, importance, emailed_at")
      .eq("user_id", id).gte("created_at", debut.toISOString()).order("importance", { ascending: false }).limit(200);
    const cat = (n: any) => n.categorie || (n.position || n.type === "vote" ? "votes" : n.type === "local" ? "local" : n.type === "loi" ? "lois" : "suivis");
    const votes = (notifs || []).filter(n => cat(n) === "votes");
    const suivis = (notifs || []).filter(n => cat(n) === "suivis");

    // Territoire : sa commune d'abord, puis son département (ou sa région), selon son périmètre.
    const perimetre = p?.perimetre || "departement";
    const local: Info[] = perimetre === "national" ? [] : fil.filter((f: any) =>
      (f.entity_type === "commune" && String(f.entity_id) === loc.communeCode)
      || (perimetre !== "commune" && f.entity_type === "department" && String(f.entity_id) === loc.deptCode && f.place_scope !== "commune")
      || (perimetre === "region" && f.entity_type === "region" && String(f.entity_id) === loc.regionCode))
      .sort((a: any, b: any) => Number(b.entity_type === "commune") - Number(a.entity_type === "commune") || importanceOf(b.news_type) - importanceOf(a.news_type))
      .slice(0, 4).map((f: any) => ({ titre: f.title, resume: f.summary, url: f.url, date: f.published_at, source: "local", importance: 3, etiquette: f.place || null }));

    // Centres d'intérêt : ce que la semaine a produit sur ses sujets.
    const vus = new Set<string>();
    const sujets = commun.reservoir.map(i => ({ ...i, domaines: matchDomains(`${i.titre} ${i.resume || ""}`).filter(d => interets.includes(d)) }))
      .filter(i => i.domaines.length && !vus.has(norm(i.titre)) && vus.add(norm(i.titre)))
      .sort((a, b) => b.importance - a.importance).slice(0, 4).map(i => ({ ...i, domaine: i.domaines[0] }));

    const { html, desabo, minutes } = composer(commun, ed, {
      prenom: prenom.get(id) || "", votes, suivis, local, sujets, lieu: p?.city || null, demo, jeton: p?.jeton_desabo || null,
    }, debut, fin);

    if (APERCU) {
      const fs = await import("node:fs"); fs.writeFileSync(APERCU, html); console.log(`[Récap] Aperçu écrit : ${APERCU} (${minutes} min de lecture).`); return;
    }
    const adresse = adresses.get(id);
    if (!adresse) continue;
    const sujet = ed?.accroche ? `La semaine politique en 5 min : ${ed.accroche}` : `La semaine politique en 5 minutes — ${fmtJour(fin)}`;
    if (await envoyerMail(adresse, sujet.slice(0, 140), html, { desabo })) {
      envoyes++;
      if (!TEST && !simulation) {
        await supabase.from("recaps_envoyes").upsert({ user_id: id, semaine: samedi, nb_items: votes.length + suivis.length + local.length + sujets.length }, { onConflict: "user_id,semaine" });
        // Les alertes au rythme « hebdo » sont servies par ce récap : elles ne repartiront pas seules.
        const enAttente = (notifs || []).filter(n => !n.emailed_at).map(n => n.id);
        if (enAttente.length) await supabase.from("user_notifications").update({ emailed_at: new Date().toISOString() }).in("id", enAttente);
      }
    }
    await new Promise(r => setTimeout(r, 600));
  }
  console.log(`[Récap] ${envoyes} récap(s) envoyé(s)${simulation ? " — SIMULATION" : ""}.`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
