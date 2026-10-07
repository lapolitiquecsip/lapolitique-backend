import "dotenv/config";
import crypto from "crypto";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { dureeEtSousTitres, transcrireGemini } from "../../lib/transcription.js";

/**
 * Programmes présentés en VIDÉO sur la chaîne officielle d'un candidat (ex. Marine Le Pen,
 * 6 octobre 2026 : « trajectoire financière du quinquennat », contre-budget du RN).
 *
 *  1. Détection : vidéo récente de la chaîne officielle (candidate_videos), titre de
 *     présentation d'un programme, 10 min au moins, jamais traitée (programmes_sources).
 *  2. Transcription : sous-titres automatiques (yt-dlp) ; secours : Gemini lit la vidéo.
 *  3. Vérification : l'IA confirme qu'il s'agit bien d'une présentation de programme.
 *  4. Restructuration FIDÈLE au même format que les programmes écrits (Lisnard) : thèmes,
 *     contexte par thème, propositions concrètes. Garde-fou : une proposition dont un
 *     chiffre n'apparaît pas dans la transcription est rejetée.
 *  5. Écriture dans candidate_proposals (source_url = la vidéo) ; les « ? » explicatifs
 *     suivent par explain-proposals (cron presidentielles-sync).
 *
 * Usage : npx tsx src/scripts/data/programmes-videos.ts [--url=https://youtube.com/watch?v=…] [--jours=14] [--force]
 */
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const URL_SEULE = arg("url");
const JOURS = Number(arg("jours") || 14);
const FORCE = process.argv.includes("--force");
const CONTEXTE = "__contexte__";
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

const TITRE_PROGRAMME = /(programme|projet|trajectoire|contre[- ]budget|budget|propositions|mesures|plan |r[ée]forme|pr[ée]sente (son|sa|ses|le|la|les|notre))/i;
const THEMES = ["Économie et budget", "Fiscalité", "Dépenses publiques et État", "Retraites et protection sociale", "Travail et emploi",
  "Collectivités locales", "Immigration", "Sécurité et justice", "Défense et international", "Europe", "Énergie et environnement",
  "Agriculture", "Éducation", "Recherche et innovation", "Santé", "Logement", "Institutions et démocratie", "Culture et société"];

/* ───────── IA ───────── */

async function json(system: string, contenu: string, maxTokens = 6000): Promise<any> {
  for (const payant of [false, true]) {
    try {
      const r = await resilientDeepSeek.createMessage({ model: "deepseek-chat", max_tokens: maxTokens, responseFormat: "json_object", sansReflexion: true,
        system, messages: [{ role: "user", content: contenu }] }, { payant, timeoutMs: 150000 });
      const t = r.content?.[0]?.type === "text" ? r.content[0].text : "";
      return JSON.parse(t.match(/\{[\s\S]*\}/)?.[0] || "{}");
    } catch { /* gratuit saturé → payant */ }
  }
  return null;
}

const VERIF = `On te donne le début de la transcription d'une vidéo publiée sur la chaîne officielle d'un·e candidat·e à l'élection présidentielle française. Dis si c'est une PRÉSENTATION DE PROGRAMME (mesures concrètes, chiffrées ou non, sur un ou plusieurs domaines) — et non un simple meeting, une interview ou une réaction à l'actualité.
JSON strict : { "programme": true, "intitule": "intitulé court et neutre, ex. « Programme économique et budgétaire »" }`;

const EXTRAIRE = `On te donne un EXTRAIT de la transcription automatique (sous-titres) d'une présentation de programme par un·e candidat·e à la présidentielle. Tu en extrais, FIDÈLEMENT, les PROPOSITIONS CONCRÈTES (ce que le candidat s'engage à faire, avec ses chiffres), classées par thème.

RÈGLES ABSOLUES :
- EXHAUSTIVITÉ : relève TOUTES les mesures annoncées, y compris celles citées en liste ou en passant (droits nouveaux, provisions, réformes annoncées pour plus tard).
- Aucune invention, aucun ajout, aucun chiffre absent du texte. Chaque chiffre est repris EXACTEMENT comme prononcé.
- Un chiffre manifestement déformé par la transcription (« - 1 % » contredit plus loin, « 03 points ») : garde la mesure SANS ce chiffre, ne le corrige jamais toi-même.
- Ignore les attaques contre les adversaires, le bilan des autres, les généralités sans engagement.
- Sous-titres automatiques : s'il y a un mot manifestement mal transcrit et que le sens est certain, corrige-le ; si le sens est douteux, n'utilise pas ce passage.
- Une proposition = 1 phrase claire, neutre (« Réduire de X… », « Créer… », « Supprimer… »), sans « je ».
- "constat" : ce que le candidat dit de la situation qui motive ses mesures, 1 phrase, s'il y en a un.
- Thème : un parmi ${THEMES.join(" | ")}.
JSON strict : { "themes": [ { "theme": "…", "constat": "… ou null", "propositions": ["…"] } ] }`;

const CONTEXTE_SYS = `On te donne les constats et propositions d'un thème d'un programme présidentiel. Écris le CONTEXTE du thème : 1 à 2 phrases (350 caractères maximum), neutres, qui disent le constat et l'objectif du candidat, en reprenant uniquement ce qui est fourni (aucun chiffre ajouté).
ATTRIBUTION OBLIGATOIRE : un constat ou un jugement du candidat n'est JAMAIS présenté comme un fait. Écris « Selon [nom], … », « [Nom] estime que … », « [Nom] veut … ». Aucune attaque contre un adversaire.
JSON strict : { "contexte": "…" }`;

const NETTOYER = `On te donne les propositions extraites d'un thème d'un programme présidentiel (transcription automatique d'un discours). Indique celles à GARDER : retire les doublons (garde la plus complète), les phrases qui ne sont pas des engagements (commentaire sur un tableau, généralité), et celles rendues incompréhensibles par une erreur de transcription. Tu peux corriger un mot mal transcrit SEULEMENT si la correction est certaine (« financements à Toba, tout projet » → « financements à tout projet »).
JSON strict : { "garder": [ { "i": 0, "texte": "proposition, corrigée si nécessaire, sinon identique" } ] }`;

/** Garde-fou : tous les nombres de la proposition figurent dans la transcription. */
function chiffresPresents(prop: string, transcription: string): boolean {
  const nombres = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) || []).map(n => n.replace(",", "."));
  const dispo = new Set(nombres(transcription.replace(/\s(?=\d{3}\b)/g, "")));
  return nombres(prop).every(n => dispo.has(n) || n.length <= 1);
}

function tranches(texte: string, taille = 9000): string[] {
  const phrases = texte.split(/(?<=[.!?])\s+/);
  const out: string[] = []; let cur = "";
  for (const p of phrases) {
    if ((cur + " " + p).length > taille && cur) { out.push(cur); cur = ""; }
    cur += (cur ? " " : "") + p;
  }
  if (cur) out.push(cur);
  return out;
}

async function traiter(v: { candidate_id: string; url: string; title: string; nom: string }) {
  console.log(`> ${v.nom} — « ${v.title} »`);
  let { duree, texte } = dureeEtSousTitres(v.url);
  let methode = "sous-titres";
  if (duree && duree < 600) { console.log(`  · ${Math.round(duree / 60)} min : trop court pour un programme.`); return; }
  if (texte.length < 3000) { texte = await transcrireGemini(v.url); methode = "gemini"; }
  if (texte.length < 3000) {
    console.log("  ! transcription impossible (sous-titres et Gemini).");
    await supabase.from("programmes_sources").upsert({ source_url: v.url, candidate_id: v.candidate_id, titre: v.title, statut: "transcription_impossible" });
    return;
  }
  const verif = await json(VERIF, texte.slice(0, 7000), 500);
  if (!verif?.programme) {
    console.log("  · pas une présentation de programme.");
    await supabase.from("programmes_sources").upsert({ source_url: v.url, candidate_id: v.candidate_id, titre: v.title, statut: "pas_un_programme", methode });
    return;
  }

  const parTheme = new Map<string, { constats: string[]; props: string[] }>();
  let rejetees = 0;
  for (const t of tranches(texte)) {
    const r = await json(EXTRAIRE, t);
    for (const th of r?.themes || []) {
      const nom = THEMES.find(x => norm(x) === norm(th.theme)) || "Économie et budget";
      const e = parTheme.get(nom) || { constats: [], props: [] };
      if (th.constat && typeof th.constat === "string") e.constats.push(th.constat);
      for (const p of th.propositions || []) {
        if (typeof p !== "string" || p.trim().length < 12) continue;
        if (!chiffresPresents(p, texte)) { rejetees++; continue; }
        if (!e.props.some(x => norm(x) === norm(p))) e.props.push(p.trim().slice(0, 320));
      }
      parTheme.set(nom, e);
    }
  }

  const maintenant = new Date().toISOString();
  const lignes: any[] = [];
  let ordre = 1000;   // après les programmes écrits éventuels
  for (const [theme, e] of [...parTheme].filter(([, e]) => e.props.length).sort((a, b) => b[1].props.length - a[1].props.length)) {
    const net = await json(NETTOYER, e.props.map((p, i) => `[${i}] ${p}`).join("\n"), 4000);
    if (Array.isArray(net?.garder) && net.garder.length) {
      e.props = net.garder.map((g: any) => ({ src: e.props[Number(g.i)], txt: String(g.texte || "") }))
        .filter((g: any) => g.src && g.txt.length > 10 && chiffresPresents(g.txt, texte)).map((g: any) => g.txt.slice(0, 320));
    }
    if (!e.props.length) continue;
    const ctx = await json(CONTEXTE_SYS, `Candidat : ${v.nom}\nThème : ${theme}\nConstats : ${e.constats.join(" ")}\nPropositions :\n- ${e.props.join("\n- ")}`, 600);
    if (ctx?.contexte && chiffresPresents(ctx.contexte, texte) && String(ctx.contexte).length <= 420)
      lignes.push({ id: md5(`${v.candidate_id}|ctx|${v.url}|${norm(theme)}`), candidate_id: v.candidate_id, theme, subsection: CONTEXTE, text: String(ctx.contexte), source_url: v.url, sort_order: ordre++, updated_at: maintenant });
    for (const p of e.props)
      lignes.push({ id: md5(`${v.candidate_id}|${norm(p)}`), candidate_id: v.candidate_id, theme, subsection: null, text: p, source_url: v.url, sort_order: ordre++, updated_at: maintenant });
  }
  const nb = lignes.filter(l => l.subsection !== CONTEXTE).length;
  console.log(`  ✓ ${nb} proposition(s) en ${parTheme.size} thème(s) (${rejetees} rejetée(s) : chiffre absent de la transcription) — ${methode}.`);
  if (!nb) return;
  await supabase.from("candidate_proposals").delete().eq("candidate_id", v.candidate_id).eq("source_url", v.url);
  const uniq = [...new Map(lignes.map(l => [l.id, l])).values()];
  const { error } = await supabase.from("candidate_proposals").upsert(uniq, { onConflict: "id" });
  if (error) throw error;
  await supabase.from("programmes_sources").upsert({ source_url: v.url, candidate_id: v.candidate_id, titre: verif.intitule || v.title, statut: "programme", nb_propositions: nb, methode, traite_le: maintenant });
  await alerterSuiveurs(v, verif.intitule || "son programme", nb, [...parTheme.keys()].length);
}

/**
 * Fait majeur (importance 5) pour les membres qui suivent le candidat ou son parti, avec
 * leur accord explicite (RGPD art. 9) : parti immédiatement par l'e-mail des alertes Pro.
 */
async function alerterSuiveurs(v: { candidate_id: string; url: string; nom: string }, intitule: string, nb: number, nbThemes: number) {
  const { data: c } = await supabase.from("presidential_candidates").select("slug, party").eq("id", v.candidate_id).maybeSingle();
  const { data: partis } = await supabase.from("political_parties").select("slug, name, abbrev");
  const slugsParti = (partis || []).filter((p: any) => c?.party && (norm(p.name) === norm(c.party) || norm(p.name).startsWith(norm(c.party) + " ") || norm(p.abbrev || "") === norm(c.party))).map((p: any) => p.slug);
  const { data: suivis } = await supabase.from("user_suivis").select("user_id, kind, ref, label")
    .or([`and(kind.eq.candidat,ref.eq.${v.candidate_id})`, ...slugsParti.map((s: string) => `and(kind.eq.parti,ref.eq.${s})`)].join(","));
  const { data: accords } = await supabase.from("user_preferences").select("user_id").not("consentement_suivis", "is", null);
  const ok = new Set((accords || []).map((a: any) => a.user_id));
  const parUser = new Map<string, any>();
  for (const s of suivis || []) if (ok.has(s.user_id) && !parUser.has(s.user_id)) parUser.set(s.user_id, s);
  const site = process.env.SITE_URL || "https://lapolitiquecestsimple.fr";
  const lignes = [...parUser.values()].map((s: any) => ({
    user_id: s.user_id, type: `suivi_${s.kind}`, categorie: "suivis", importance: 5, read: false,
    title: `${v.nom} présente ${intitule.charAt(0).toLowerCase() + intitule.slice(1)}`.slice(0, 300),
    detail: `${nb} propositions en ${nbThemes} thèmes, tirées de sa présentation officielle, à lire sur sa fiche (avec le « ? » qui explique chacune).`,
    domain: String(s.label || v.nom).slice(0, 60), url: c?.slug ? `${site}/presidentielles-2027/?candidat=${c.slug}` : `${site}/presidentielles-2027/`,
    event_at: new Date().toISOString(), dedup_key: `programme|${v.url}`,
  }));
  if (lignes.length) await supabase.from("user_notifications").upsert(lignes, { onConflict: "user_id,dedup_key", ignoreDuplicates: true });
  console.log(`  → ${lignes.length} membre(s) qui suivent ${v.nom} ou son parti prévenu(s).`);
}

async function main() {
  const { data: cands } = await supabase.from("presidential_candidates").select("id, full_name").eq("status", "declared");
  const nomDe = new Map((cands || []).map((c: any) => [c.id, c.full_name]));
  let videos: any[];
  if (URL_SEULE) {
    const { data } = await supabase.from("candidate_videos").select("candidate_id, url, title, published_at").eq("url", URL_SEULE);
    videos = data || [];
  } else {
    const { data } = await supabase.from("candidate_videos").select("candidate_id, url, title, published_at")
      .gte("published_at", new Date(Date.now() - JOURS * 864e5).toISOString()).order("published_at", { ascending: true });
    videos = (data || []).filter((v: any) => nomDe.has(v.candidate_id) && TITRE_PROGRAMME.test(v.title || ""));
  }
  const { data: faits } = await supabase.from("programmes_sources").select("source_url, candidate_id, statut, traite_le");
  for (const v of videos) {
    if (!FORCE && (faits || []).some((f: any) => f.source_url === v.url)) continue;
    // Même présentation publiée deux fois (direct puis version montée) : une seule.
    if (!FORCE && !URL_SEULE && (faits || []).some((f: any) => f.candidate_id === v.candidate_id && f.statut === "programme"
      && Math.abs(new Date(f.traite_le).getTime() - new Date(v.published_at).getTime()) < 3 * 864e5)) continue;
    try { await traiter({ ...v, nom: nomDe.get(v.candidate_id) || "?" }); }
    catch (e: any) { console.warn(`  ! ${v.url} : ${e.message}`); }
    const { data: maj } = await supabase.from("programmes_sources").select("source_url, candidate_id, statut, traite_le");
    faits?.splice(0, faits.length, ...(maj || []));
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
