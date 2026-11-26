import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { supabase } from "../../config/supabase.js";
import { redigerActu, redigerProgramme, type Consignes } from "../../lib/basile.js";
import { publierCarrousel, publierStory } from "../../lib/instagram.js";
import { aExecuter, aRevoir, demander, echec, encoreValidee, executee, noter, passage } from "../../lib/qg.js";
import { affiche, carrouselActu, paletteDuPost, type NomPalette } from "../../lib/visuels/charte.js";
import { capturesSite, DOSSIER_ASSETS, rendrePages, rendreProgramme } from "../../lib/visuels/rendu.js";

/**
 * La chaîne Instagram de bout en bout (26/11/2026) — remplace la validation dans Notion.
 *
 *   --preparer (8 h 10, heure de Paris) : pour chaque carrousel du jour dans la stratégie ACTIVE,
 *     Noémie choisit le sujet (programme d'un candidat pour la série, sinon la meilleure idée de
 *     Lucie : ce qui paraît sur le site + l'actu politique), Basile écrit, Rose met en page (palette
 *     suivante de la rotation), puis Hippolyte reçoit le post sur WhatsApp avec ses sources.
 *   --publier (toutes les 15 min) : ✏️ → Basile et Rose refont le post avec la consigne (gardée comme
 *     leçon) et le renvoient ; ✅ → publication à l'heure du créneau (ou tout de suite si l'heure est
 *     passée), avec la story pour les programmes.
 *   --essai [--type=programme|actu] : prépare en local, sans rien envoyer ni publier.
 *
 * Rien ne part sans ✅ (qg.ts). Coût : Gemini gratuit (DeepSeek en secours, budget « reseaux »).
 */
const NOEMIE = "tache:back:publications-reseaux.yml";
const AGENT = "tache:back:instagram-production.yml";
const ACTION = "publier_instagram";
const ESSAI = process.argv.includes("--essai");
const TYPE_FORCE = process.argv.find(a => a.startsWith("--type="))?.split("=")[1];
const EXCLUS = new Set(["controverse", "suivi", "debat"]);
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const B = supabase.storage.from("publications");
const pub = (chemin: string) => B.getPublicUrl(chemin).data.publicUrl;
// Sur GitHub : le Chromium de Playwright ; sur le PC d'Hippolyte : son Chrome.
const NAV = process.env.CI ? {} : { channel: "chrome" };

const paris = (d = new Date()) => new Date(d.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
const jourIso = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
/** « 12:30 » aujourd'hui (heure de Paris) en ISO UTC. */
function aujourdhuiA(heure: string) {
  const d = new Date();
  const decalage = Math.round((paris(d).getTime() - new Date(d.toLocaleString("en-US", { timeZone: "UTC" })).getTime()) / 3600e3);
  return new Date(`${jourIso()}T${heure}:00+0${decalage}:00`).toISOString();
}

type Creneau = { format: string; heure: string; contenu: string };
type Sujet = { type: "programme"; slug: string; nom: string; themes: string[] } | { type: "actu"; cle: string };

/** Les carrousels du jour selon la stratégie active (et la montée en charge de décembre). */
async function creneauxDuJour(): Promise<Creneau[]> {
  const { data: s } = await supabase.from("instagram_strategie").select("version, calendrier, regles").eq("statut", "active").maybeSingle();
  if (!s) return [];
  const jour = JOURS[paris().getDay()];
  let liste = ((s.calendrier as any)?.[jour] ?? []) as Creneau[];
  // « Décembre : 3 carrousels (lundi, mercredi, samedi) + 1 reel (vendredi) » : jusqu'au 31/12, seuls ces jours.
  const montee = String((s.regles as any)?.montee_en_charge ?? "");
  const jours = /\(([^)]*)\)/.exec(montee)?.[1]?.toLowerCase();
  if (jours && jourIso() < "2027-01-01" && !jours.includes(jour)) liste = liste.filter(c => c.format !== "carrousel");
  return liste;
}

/** La série « programme » : le candidat le moins récemment traité qui a un portrait validé, ses 4 grands thèmes pas encore faits. */
async function choisirProgramme(): Promise<Sujet | null> {
  const { data: fichiers } = await B.list("portraits", { limit: 1000 });
  const avecPortrait = new Set((fichiers ?? []).filter(f => f.name.endsWith(".png")).map(f => f.name.replace(/\.png$/, "")));
  const { data: gens } = await supabase.from("presidential_candidates").select("id, slug, full_name").eq("status", "declared");
  const { data: faits } = await supabase.from("instagram_fiches").select("fiche, cree_le").eq("fiche->>gabarit", "programme").order("cree_le", { ascending: false }).limit(60);
  const dernier = new Map<string, string>();
  const themesFaits = new Map<string, Set<string>>();
  for (const f of faits ?? []) {
    const fi = f.fiche as any;
    if (!dernier.has(fi.slug)) dernier.set(fi.slug, f.cree_le);
    for (const t of fi.themes ?? []) (themesFaits.get(fi.slug) ?? themesFaits.set(fi.slug, new Set()).get(fi.slug))!.add(t);
  }
  const candidats = (gens ?? []).filter((g: any) => avecPortrait.has(g.slug)).sort((a: any, b: any) => (dernier.get(a.slug) ?? "").localeCompare(dernier.get(b.slug) ?? ""));
  for (const g of candidats as any[]) {
    const { data: props } = await supabase.from("candidate_proposals").select("theme").eq("candidate_id", g.id).limit(1000);
    const compte = new Map<string, number>();
    for (const p of props ?? []) compte.set(p.theme, (compte.get(p.theme) ?? 0) + 1);
    const deja = themesFaits.get(g.slug) ?? new Set();
    const themes = [...compte.entries()].filter(([t, n]) => n >= 3 && t.length < 60 && !deja.has(t)).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
    if (themes.length >= 2) return { type: "programme", slug: g.slug, nom: g.full_name, themes };
  }
  return null;
}

/** La meilleure idée récente de Lucie (site + actu), pas encore utilisée ; « chiffre » privilégie les chiffres officiels. */
async function choisirActu(indice: string): Promise<Sujet | null> {
  const depuis = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const { data } = await supabase.from("veille_posts").select("cle, importance").eq("statut", "pret").gte("jour", depuis)
    .not("faits", "is", null).order("importance", { ascending: false }).order("detecte_le", { ascending: false }).limit(80);
  const { data: utilisees } = await supabase.from("instagram_fiches").select("fiche").gte("cree_le", new Date(Date.now() - 14 * 86400_000).toISOString());
  const deja = new Set((utilisees ?? []).map((f: any) => f.fiche?.idee).filter(Boolean));
  const ok = (data ?? []).filter((i: any) => !EXCLUS.has(i.cle.split(":")[0]) && !deja.has(i.cle) && i.importance >= 4);
  const chiffre = /chiffre/i.test(indice) ? ok.find((i: any) => i.cle.startsWith("indicateur:")) : null;
  const choix = chiffre ?? ok[0];
  return choix ? { type: "actu", cle: choix.cle } : null;
}

async function lecons(): Promise<string[]> {
  const { data } = await supabase.from("instagram_lecons").select("lecon").eq("source", "consigne").eq("active", true).order("cree_le", { ascending: false }).limit(15);
  return (data ?? []).map((l: any) => l.lecon);
}

/** Bibliothèque d'objets : les images envoyées sur WhatsApp (storage objets/) remplacent celles du dépôt. */
async function synchroniserObjets() {
  const { data } = await B.list("objets", { limit: 1000 });
  const dossier = join(fileURLToPath(DOSSIER_ASSETS), "objets");
  mkdirSync(dossier, { recursive: true });
  for (const f of data ?? []) {
    if (!f.name.endsWith(".png")) continue;
    const r = await fetch(pub(`objets/${f.name}`));
    if (r.ok) writeFileSync(join(dossier, f.name), Buffer.from(await r.arrayBuffer()));
  }
}

type Rendu = { slides: string[]; story: string | null; legende: string; aVerifier: string[]; sources: string[]; fiche: Record<string, unknown> };

/** Basile écrit, Rose met en page ; les JPEG sont rangés dans le stockage (URL publiques pour Instagram). */
async function fabriquer(sujet: Sujet, palette: NomPalette, ref: string, k: Consignes): Promise<Rendu> {
  const sortie = join(tmpdir(), `ig-${ref.slice(4)}-${Date.now()}`);
  let fichiers: string[] = [], story: string | null = null, legende = "", aVerifier: string[] = [], sources: string[] = [], fiche: Record<string, unknown>;
  if (sujet.type === "programme") {
    const p = await redigerProgramme(sujet.slug, sujet.themes, 8, k);
    if (p.themes.length < 2) throw new Error(`Basile n'a pas assez de matière pour ${sujet.nom}`);
    const credit = await fetch(pub(`portraits/${sujet.slug}.json`)).then(r => (r.ok ? r.json() : {})).then((j: any) => j.texte ?? undefined).catch(() => undefined);
    const captures = await capturesSite(`https://lapolitiquecestsimple.fr/presidentielles-2027/?candidat=${sujet.slug}`, join(sortie, "captures"), ["Programme", "Parcours"], NAV).catch(() => []);
    fichiers = await rendreProgramme({
      candidat: sujet.nom, slug: sujet.slug, palette, portrait: pub(`portraits/${sujet.slug}.png`), creditPhoto: credit,
      themes: p.themes, captures: captures.map(f => pathToFileURL(f).href), dossier: DOSSIER_ASSETS,
    }, join(sortie, "slides"), NAV);
    const [s] = await rendrePages([affiche({ nom: sujet.nom, liaison: "pour", theme: "2027 ?", contexte: "Son programme en " + p.themes.length + " thèmes · nouveau post",
      portrait: pub(`portraits/${sujet.slug}.png`), objet: `${DOSSIER_ASSETS}/objets/democratie.png`, creditPhoto: credit, palette, format: "story" })], join(sortie, "story"), { ...NAV, tolerer: true });
    story = s;
    legende = [p.legende, p.hashtags.join(" ")].filter(Boolean).join("\n\n");
    aVerifier = p.a_verifier;
    sources = p.themes.map((t, i) => `slide ${i + 2} (${t.titre}) : ${t.source}`);
    fiche = { gabarit: "programme", type: "programme", slug: sujet.slug, themes: sujet.themes, palette, slides: fichiers.length, accroche: `Programme ${sujet.nom}` };
  } else {
    const { data: idee } = await supabase.from("veille_posts").select("cle, titre, faits, source, url, lien_site, jour, importance").eq("cle", sujet.cle).single();
    const a = await redigerActu({ titre: idee.titre, faits: idee.faits, source: idee.source, url: idee.url, date: idee.jour }, k);
    if (!a.slides.length) throw new Error(`Basile n'a rien pu écrire sur « ${idee.titre} »`);
    const captures = idee.lien_site ? await capturesSite(idee.lien_site, join(sortie, "captures"), [], NAV).catch(() => []) : [];
    fichiers = await rendrePages(carrouselActu({ dossier: DOSSIER_ASSETS, slides: a.slides, captures: captures.map(f => pathToFileURL(f).href) }), join(sortie, "slides"), NAV);
    legende = [a.legende, a.hashtags.join(" ")].filter(Boolean).join("\n\n");
    aVerifier = a.a_verifier;
    sources = [`toutes les slides : ${a.slides[0]?.source}${idee.url ? ` (${idee.url})` : ""}`];
    fiche = { gabarit: "actu", type: idee.cle.split(":")[0], idee: idee.cle, importance: idee.importance, slides: fichiers.length, accroche: idee.titre, source: idee.source };
  }
  if (ESSAI) { console.log(`[essai] ${fichiers.length} slides dans ${sortie}`); return { slides: fichiers, story, legende, aVerifier, sources, fiche }; }
  const dossier = `ig/${jourIso()}/${ref.slice(4)}-${Date.now().toString(36)}`;
  const envoyer = async (f: string, nom: string) => {
    const { error } = await B.upload(`${dossier}/${nom}`, readFileSync(f), { contentType: "image/jpeg", upsert: true });
    if (error) throw new Error(`Stockage : ${error.message}`);
    return pub(`${dossier}/${nom}`);
  };
  const slides: string[] = [];
  for (const [i, f] of fichiers.entries()) slides.push(await envoyer(f, `${String(i + 1).padStart(2, "0")}.jpg`));
  return { slides, story: story ? await envoyer(story, "story.jpg") : null, legende, aVerifier, sources, fiche };
}

async function deposer(sujet: Sujet, c: Creneau, heureIso: string, version = 1, k: Consignes = {}) {
  const { count } = await supabase.from("instagram_fiches").select("ref", { count: "exact", head: true }).eq("fiche->>gabarit", "programme");
  const palette = paletteDuPost(count ?? 0);
  const ref = `ref:${createHash("md5").update(`${jourIso()}|${c.heure}|${JSON.stringify(sujet)}`).digest("hex").slice(0, 16)}`;
  const r = await fabriquer(sujet, palette, ref, { lecons: await lecons(), ...k });
  if (ESSAI) return;
  await supabase.from("instagram_fiches").upsert({ ref, fiche: { ...r.fiche, prepare_le: new Date().toISOString(), heure: c.heure, version } });
  const titre = sujet.type === "programme" ? `Programme de ${sujet.nom}` : String(r.fiche.accroche ?? "Actu");
  await demander({
    agent: NOEMIE, equipe: "marketing", action: ACTION, cle: `ig-${jourIso()}-${c.heure}${version > 1 ? `-v${version}` : ""}`,
    titre: `Post Instagram ${c.heure} : ${titre}${version > 1 ? ` (v${version})` : ""}`,
    resume: `${r.slides.length} slides${r.story ? " + story" : ""} · publication à ${c.heure}${r.aVerifier.length ? ` · ⚠️ À vérifier : ${r.aVerifier.slice(0, 3).join(" ; ")}` : " · rien à vérifier"}`,
    apercu: {
      image: r.slides[0], images: r.slides, story: r.story,
      texte: `${r.legende}\n\nSOURCES\n${r.sources.join("\n")}${r.aVerifier.length ? `\n\nÀ VÉRIFIER\n${r.aVerifier.join("\n")}` : ""}`,
      legende: r.legende, heure: heureIso, ref, sujet, creneau: c, version,
    },
    risque: r.aVerifier.length ? "normal" : "faible",
    expire_dans_heures: Math.max(6, (Date.parse(heureIso) - Date.now()) / 3600e3 + 12),
  });
  console.log(`Déposé : ${titre} (${c.heure}, palette ${palette}, ${r.slides.length} slides).`);
}

async function preparer() {
  if (!ESSAI) await synchroniserObjets().catch(e => console.log(`::notice::objets : ${(e as Error).message}`));
  const creneaux = await creneauxDuJour();
  if (!creneaux.length && !TYPE_FORCE) { console.log("Aucun créneau aujourd'hui (repos ou montée en charge)."); return; }
  const liste = TYPE_FORCE ? [{ format: "carrousel", heure: "12:30", contenu: TYPE_FORCE === "programme" ? "Programme d'un candidat" : "Actu décryptée" }] : creneaux;
  for (const c of liste) {
    if (c.format === "reel") {
      if (!ESSAI) await noter({ agent: NOEMIE, equipe: "marketing", genre: "attention", message: `Reel prévu à ${c.heure} (« ${c.contenu} ») : à faire à la main, Oscar n'est pas encore là.` });
      continue;
    }
    if (c.format !== "carrousel") continue;
    const deja = !ESSAI && (await supabase.from("qg_demandes").select("id").eq("cle", `ig-${jourIso()}-${c.heure}`).maybeSingle()).data;
    if (deja) { console.log(`Déjà préparé : ${c.heure}.`); continue; }
    const sujet = /programme|candidat/i.test(c.contenu) ? (await choisirProgramme()) ?? (await choisirActu(c.contenu)) : (await choisirActu(c.contenu)) ?? (await choisirProgramme());
    if (!sujet) { console.log(`::warning::Aucun sujet pour ${c.heure}.`); continue; }
    try {
      await deposer(sujet, c, aujourdhuiA(c.heure));
    } catch (e) {
      console.log(`::warning::${c.heure} : ${(e as Error).message}`);
      if (!ESSAI) await noter({ agent: NOEMIE, equipe: "marketing", genre: "panne", message: `Post de ${c.heure} non préparé : ${(e as Error).message}` });
    }
  }
}

async function publier() {
  // ✏️ : Basile et Rose refont le post avec la consigne, qui devient une leçon durable.
  for (const d of (await aRevoir(NOEMIE)).filter(x => x.action === ACTION)) {
    const a = d.apercu as any;
    const consigne = (d.commentaire ?? "").trim();
    if (!consigne || !a?.sujet) continue;
    await supabase.from("instagram_lecons").insert({ source: "consigne", lecon: consigne.replace(/📎\s*\S+/g, "").trim() || consigne, preuve: { demande: d.id } });
    await supabase.from("qg_demandes").update({ statut: "annulee", resultat: { refait: true } }).eq("id", d.id);
    try {
      await deposer(a.sujet, a.creneau, Date.parse(a.heure) > Date.now() ? a.heure : new Date(Date.now() + 15 * 60e3).toISOString(), (a.version ?? 1) + 1, { maintenant: consigne });
    } catch (e) {
      await noter({ agent: NOEMIE, equipe: "marketing", genre: "panne", demande: d.id, message: `Le post n'a pas pu être refait : ${(e as Error).message}` });
    }
  }
  // ✅ : publication à l'heure prévue.
  for (const d of await aExecuter(NOEMIE, ACTION)) {
    const a = d.apercu as any;
    if (Date.parse(a.heure) > Date.now()) continue;
    if (!(await encoreValidee(d.id))) continue;
    try {
      const { id, permalink } = await publierCarrousel(a.images, a.legende ?? "");
      let story: string | null = null;
      if (a.story) story = await publierStory(a.story).then(s => s.permalink).catch(e => { console.log(`::notice::story : ${(e as Error).message}`); return null; });
      const { data: f } = await supabase.from("instagram_fiches").select("fiche").eq("ref", a.ref).maybeSingle();
      await supabase.from("instagram_posts").upsert({ media_id: id, format: "carrousel", publie_le: new Date().toISOString(), permalink, ref: a.ref, fiche: { ...(f?.fiche ?? {}), via: "qg" } });
      await executee(d, { lien: permalink, story });
      console.log(`Publié : ${d.titre} → ${permalink}`);
    } catch (e) {
      await echec(d, (e as Error).message);
    }
  }
}

async function main() {
  // Pour GitHub : faut-il installer le navigateur (refaire un post après ✏️) ?
  if (process.argv.includes("--besoin")) {
    const n = (await aRevoir(NOEMIE)).filter(x => x.action === ACTION).length;
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `refaire=${n}
`, { flag: "a" });
    console.log(`${n} post(s) à refaire.`);
    return;
  }
  if (process.argv.includes("--preparer") || ESSAI) await preparer();
  if (process.argv.includes("--publier")) await publier();
  if (!ESSAI) await passage(AGENT, "ok").catch(() => null);
}

main().then(() => process.exit(0)).catch(async e => {
  const m = String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 400);
  console.log(`::error::${m}`);
  if (!ESSAI) await passage(AGENT, "panne", m).catch(() => null);
  process.exit(1);
});
