import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { fetchAll } from "./generate-interest-notifications.js";
import { trouve, sansBalises } from "../../lib/veille-correspondance.js";

/**
 * Veilles par sujet des membres Pro (table veilles) : à chaque passage, les nouveautés de chaque
 * source sont confrontées aux mots-clés de chaque veille, et chaque trouvaille devient une alerte
 * (user_notifications, catégorie « veille ») avec l'extrait exact et le lien officiel.
 *
 *   amendements      amendements_an et amendements_senat (dispositif + exposé), regroupés par texte
 *   comptes_rendus   réunions de commission : titre, résumé et compte rendu intégral
 *   debats           interventions en séance publique (Assemblée), regroupées par point de l'ordre du jour
 *   journal_officiel jorf_texts : titre et explication de chaque texte du JO
 *   agenda           events : ordres du jour de l'Assemblée et du Sénat
 *   textes           legislative_dossiers : chaque nouveau projet ou proposition déposé
 *
 * Chaque veille ne regarde que ce qui est arrivé depuis son dernier passage (verifie_jusqu_au), au
 * plus 7 jours en arrière. Idempotent : UNIQUE (user_id, dedup_key). Aucune IA.
 *   --dry   n'écrit rien, affiche les trouvailles
 *   --essai="mot1,mot2"  une veille fictive sur les 3 derniers jours (implique --dry)
 */
const ESSAI = process.argv.find(a => a.startsWith("--essai="))?.split("=").slice(1).join("=");
const DRY = process.argv.includes("--dry") || !!ESSAI;
const SITE_URL = process.env.SITE_URL || "https://lapolitiquecestsimple.fr";
const MAX_PAR_VEILLE = 20;
const court = (t: string, n: number) => (t.length > n ? `${t.slice(0, t.lastIndexOf(" ", n))}…` : t);

type Trouvaille = { source: string; cle: string; titre: string; detail: string; url: string; date: string | null; mot: string; nb?: number };

async function main() {
  const debutPassage = new Date().toISOString();
  const pros = new Set((await fetchAll("profiles", "id", q => q.eq("subscription_tier", "pro"))).map((p: any) => p.id));
  const veilles = ESSAI
    ? [{ id: 0, user_id: "essai", intitule: ESSAI, mots_cles: ESSAI.split(",").map(x => x.trim()), exclusions: [], sources: ["amendements", "comptes_rendus", "debats", "journal_officiel", "agenda", "textes"], rythme: "quotidien", cree_le: new Date(Date.now() - 3 * 864e5).toISOString(), verifie_jusqu_au: null }]
    : (await fetchAll("veilles", "id, user_id, intitule, mots_cles, exclusions, sources, rythme, cree_le, verifie_jusqu_au", q => q.eq("actif", true)))
      .filter((v: any) => pros.has(v.user_id) && (v.mots_cles || []).length);
  console.log(`[Veilles] ${veilles.length} veille(s) active(s).`);
  if (!veilles.length) return;

  const depuisDe = (v: any) => new Date(Math.max(Date.parse(v.verifie_jusqu_au || v.cree_le), Date.now() - 7 * 864e5)).toISOString();
  const depuis = veilles.map(depuisDe).sort()[0];
  const veut = (s: string) => veilles.some((v: any) => (v.sources || []).includes(s));

  // Nouveautés de chaque source, chargées une fois pour toutes les veilles.
  const amdtAn = veut("amendements") ? await fetchAll("amendements_an", "uid, numero, texte_uid, texte_titre, auteur, groupe, division, dispositif, expose, vu_le", q => q.gte("vu_le", depuis)) : [];
  const amdtSenat = veut("amendements") ? await fetchAll("amendements_senat", "uid, numero, texte_uid, texte_titre, auteur, groupe, division, dispositif, expose, url, vu_le", q => q.gte("vu_le", depuis)) : [];
  const reunions = veut("comptes_rendus") ? await fetchAll("commission_reports", "ref, chamber, commission, title, summary, meeting_date, cr_url, updated_at", q => q.gte("updated_at", depuis)) : [];
  const integral = new Map<string, string>();
  for (let i = 0; i < reunions.length; i += 50) {
    const { data } = await supabase.from("commission_transcripts").select("ref, texte").in("ref", reunions.slice(i, i + 50).map((r: any) => r.ref));
    for (const t of data || []) integral.set(t.ref, t.texte);
  }
  // Séances publiées ou corrigées depuis le dernier passage, et leurs interventions.
  const seances = veut("debats") ? await fetchAll("seances_comptes_rendus", "uid, url, date_seance, maj_le", q => q.gte("maj_le", depuis).not("empreinte", "is", null)) : [];
  const urlSeance = new Map(seances.map((x: any) => [x.uid, x.url]));
  const interventions: any[] = [];
  for (let i = 0; i < seances.length; i += 20) {
    interventions.push(...await fetchAll("seance_interventions", "id, seance_uid, date_seance, point, orateur, qualite, texte", q => q.in("seance_uid", seances.slice(i, i + 20).map((x: any) => x.uid))));
  }
  const majSeance = new Map(seances.map((x: any) => [x.uid, x.maj_le]));
  const jo = veut("journal_officiel") ? await fetchAll("jorf_texts", "id, edition_date, titre, nature, explication, updated_at", q => q.gte("updated_at", depuis)) : [];
  const agenda = veut("agenda") ? await fetchAll("events", "id, date, title, description, institution, source_url, collected_at", q => q.gte("collected_at", depuis).in("institution", ["AN", "Assemblée nationale", "Sénat"])) : [];
  const textes = veut("textes") ? await fetchAll("legislative_dossiers", "id, title, official_id, deposited_at, created_at, current_chamber", q => q.gte("created_at", depuis)) : [];
  console.log(`[Veilles] Depuis ${depuis.slice(0, 16)} : ${amdtAn.length + amdtSenat.length} amendement(s), ${reunions.length} réunion(s), ${jo.length} texte(s) du JO, ${agenda.length} point(s) d'agenda, ${textes.length} nouveau(x) texte(s).`);

  const lignes: any[] = [];
  for (const v of veilles) {
    const apres = depuisDe(v);
    const neuf = (d: string | null) => !!d && d >= apres;
    const m = (t: string) => trouve(t, v.mots_cles, v.exclusions || []);
    const trouvailles: Trouvaille[] = [];

    if (v.sources.includes("amendements")) {
      // Un texte = une alerte, avec ses amendements : un budget en compte des centaines.
      for (const [chambre, liste] of [["Assemblée", amdtAn], ["Sénat", amdtSenat]] as const) {
        const parTexte = new Map<string, { a: any; r: { mot: string; extrait: string } }[]>();
        for (const a of liste) {
          if (!neuf(a.vu_le)) continue;
          const r = m(sansBalises(`${a.dispositif || ""} ${a.expose || ""}`));
          if (r) parTexte.set(a.texte_uid || a.texte_titre, [...(parTexte.get(a.texte_uid || a.texte_titre) || []), { a, r }]);
        }
        for (const [texte, l] of parTexte) {
          const p = l[0];
          const auteurs = [...new Set(l.map(x => x.a.groupe ? `${x.a.auteur} (${x.a.groupe})` : x.a.auteur))].slice(0, 3).join(", ");
          trouvailles.push({
            source: "amendements", cle: `amdt|${chambre}|${texte}|${l.map(x => x.a.uid).sort()[0]}`,
            titre: `${l.length} amendement${l.length > 1 ? "s" : ""} (${chambre}) sur « ${court(p.a.texte_titre || "un texte", 90)} »`,
            detail: `${p.a.numero ? `N° ${p.a.numero}` : ""}${p.a.division ? `, ${p.a.division}` : ""} : ${p.r.extrait}${l.length > 1 ? ` — Auteurs : ${auteurs}${l.length > 3 ? "…" : ""}` : ` — ${auteurs}`}`,
            url: chambre === "Assemblée" ? `${SITE_URL}/premium/?amdt-texte=${encodeURIComponent(p.a.texte_uid || "")}#amendements` : (p.a.url || `${SITE_URL}/premium/#amendements`),
            date: p.a.vu_le, mot: p.r.mot, nb: l.length,
          });
        }
      }
    }
    if (v.sources.includes("comptes_rendus")) {
      for (const r of reunions) {
        if (!neuf(r.updated_at)) continue;
        const t = m(`${r.title || ""}. ${r.summary || ""}. ${sansBalises(integral.get(r.ref) || "")}`);
        if (t) trouvailles.push({ source: "comptes_rendus", cle: `cr|${r.ref}`, titre: `${r.chamber === "AN" ? "Assemblée" : "Sénat"} · ${r.commission || "Commission"} : ${court(r.title || "réunion", 110)}`,
          detail: t.extrait, url: r.cr_url || `${SITE_URL}/premium/#commissions`, date: r.meeting_date, mot: t.mot });
      }
    }
    if (v.sources.includes("debats")) {
      // Une séance, un point de l'ordre du jour = une alerte, avec ceux qui en ont parlé.
      const parPoint = new Map<string, { i: any; r: { mot: string; extrait: string } }[]>();
      for (const it of interventions) {
        if (!neuf(majSeance.get(it.seance_uid) || null)) continue;
        const r = m(it.texte);
        if (r) parPoint.set(`${it.seance_uid}|${it.point || ""}`, [...(parPoint.get(`${it.seance_uid}|${it.point || ""}`) || []), { i: it, r }]);
      }
      for (const [cle, l] of parPoint) {
        const p = l[0];
        const qui = [...new Set(l.map(x => x.i.qualite ? `${x.i.orateur}, ${x.i.qualite}` : x.i.orateur))].slice(0, 4).join(" ; ");
        trouvailles.push({ source: "debats", cle: `debat|${cle}`,
          titre: `En séance (${new Date(p.i.date_seance).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}) : ${court(p.i.point || "débat", 110)}`,
          detail: `${qui}${l.length > 1 ? ` (${l.length} interventions)` : ""} : ${p.r.extrait}`, url: urlSeance.get(p.i.seance_uid) || `${SITE_URL}/premium/#debats`,
          date: p.i.date_seance, mot: p.r.mot, nb: l.length });
      }
    }
    if (v.sources.includes("journal_officiel")) {
      for (const j of jo) {
        if (!neuf(j.updated_at)) continue;
        const t = m(`${j.titre || ""}. ${j.explication || ""}`);
        if (t) trouvailles.push({ source: "journal_officiel", cle: `jo|${j.id}`, titre: `Journal officiel du ${new Date(j.edition_date + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} : ${court(j.titre || "", 120)}`,
          detail: t.extrait, url: `https://www.legifrance.gouv.fr/jorf/id/${j.id}`, date: j.edition_date, mot: t.mot });
      }
    }
    if (v.sources.includes("agenda")) {
      for (const e of agenda) {
        if (!neuf(e.collected_at)) continue;
        const t = m(`${e.title || ""}. ${e.description || ""}`);
        if (t) trouvailles.push({ source: "agenda", cle: `agenda|${e.id}`, titre: `À l'agenda (${/sen/i.test(e.institution) ? "Sénat" : "Assemblée"}, ${new Date(e.date + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}) : ${court(e.title || "", 110)}`,
          detail: t.extrait, url: e.source_url || `${SITE_URL}/calendrier`, date: e.date, mot: t.mot });
      }
    }
    if (v.sources.includes("textes")) {
      for (const d of textes) {
        if (!neuf(d.created_at)) continue;
        const t = m(d.title || "");
        if (t) trouvailles.push({ source: "textes", cle: `texte|${d.id}`, titre: `Nouveau texte déposé (${d.current_chamber === "SENAT" ? "Sénat" : "Assemblée"}) : ${court(d.title, 130)}`,
          detail: `Déposé le ${d.deposited_at ? new Date(d.deposited_at + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—"}.`, url: `${SITE_URL}/lois/?dossier=${d.id}`, date: d.deposited_at, mot: t.mot });
      }
    }

    for (const t of trouvailles.slice(0, MAX_PAR_VEILLE)) {
      lignes.push({
        user_id: v.user_id, type: `veille_${t.source}`, categorie: "veille", importance: 4,
        title: t.titre.slice(0, 300), detail: t.detail.slice(0, 600), url: t.url, event_at: t.date,
        domain: v.intitule.slice(0, 80), read: false, created_at: debutPassage,
        dedup_key: `veille|${v.id}|${t.cle}`.slice(0, 400),
        donnees: { veille_id: v.id, rythme: v.rythme, source: t.source, mot: t.mot, nb: t.nb ?? 1 },
      });
    }
    if (trouvailles.length) console.log(`  « ${v.intitule} » : ${trouvailles.length} trouvaille(s)${trouvailles.length > MAX_PAR_VEILLE ? ` (${MAX_PAR_VEILLE} gardées)` : ""}.`);
  }

  if (DRY) { for (const l of lignes.slice(0, 15)) console.log(`   [${l.domain}] ${l.title}\n      ${l.detail.slice(0, 160)}`); return; }
  for (let i = 0; i < lignes.length; i += 300) {
    const { error } = await supabase.from("user_notifications").upsert(lignes.slice(i, i + 300), { onConflict: "user_id,dedup_key", ignoreDuplicates: true });
    if (error) throw error;
  }
  // Tout ce qui est arrivé avant le début de ce passage a été examiné.
  await supabase.from("veilles").update({ verifie_jusqu_au: debutPassage }).in("id", veilles.map((v: any) => v.id));
  console.log(`[Veilles] ${lignes.length} alerte(s) écrite(s).`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
