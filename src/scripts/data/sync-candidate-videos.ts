import "dotenv/config";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";

// Fil vidéo par candidat à la présidentielle 2027 — flux RSS des chaînes YouTube OFFICIELLES
// (libre, sans clé, sans quota). On ne stocke que des métadonnées ; la vidéo reste lue chez
// YouTube via l'embed officiel. AUCUNE donnée inventée : uniquement des chaînes VÉRIFIÉES.
//
// Pour ajouter un candidat : vérifier sa chaîne (youtube.com/@handle → id UC…), tester le flux
// https://www.youtube.com/feeds/videos.xml?channel_id=UC… puis l'ajouter ci-dessous.
// Valeur = channel_id (UC…) OU handle (@nom / nom) résolu automatiquement. Chaînes OFFICIELLES
// vérifiées (RSS testé). Ajouter un candidat = mettre son handle ou son channel_id.
const CHANNELS: Record<string, string> = {
  // clé = normalized_name du candidat (minuscules, sans accents)
  "david lisnard": "UC2XZY-bjIEmyLZ9MPJQytZg",      // youtube.com/davidlisnard
  "jean luc melenchon": "UCk-_PEY3iC6DIGJKuoEe9bw", // chaîne personnelle certifiée (UCKHKSD… était celle de LFI)
  "marine le pen": "UCU3z3px1_RCqYBwrs8LJVWg",      // @MarineLePenOfficiel
  "francois ruffin": "UCIQGSp79vVch0vO3Efqif_w",    // @Francois_Ruffin
  "raphael glucksmann": "UCyVYj4HdtEbcMngyD6_OLzg", // chaîne personnelle certifiée (l'ancienne de Place publique n'était plus alimentée)
  "bruno retailleau": "UCRkuLQabW1hsihpZuHJSbEA",   // chaîne personnelle certifiée
  "florian philippot": "UClaa_CwoQEmSo9Mb_M1f91g",  // chaîne personnelle certifiée
  "francois asselineau": "UCJEJTYYZkYjLnGCgRDqnIGA",// chaîne personnelle certifiée
  "marine tondelier": "UCB8Q3N-nvX1YlMUL7Zl_16w",   // Les Écologistes (chaîne actuelle du parti)
  // Ajoutées le 07/10/2026 : chaînes certifiées (badge YouTube) au nom du candidat.
  "gabriel attal": "UCOcDPuYTuxoRBtfmTBXtqBA",
  "edouard philippe": "UCoDttl6w1T-Stuw_pvNOvLA",
  "eric zemmour": "UCjTbZBXEw-gplUAnMXLYHpg",
  "nathalie arthaud": "UCZsh-MrJftAOP_-ZgRgLScw",  // Lutte ouvrière (certifiée)
  "nicolas dupont aignan": "UCfA5DnCDX3Ixy5QOAMGtBlA",
  // Non certifiées mais sans ambiguïté (audience, contenu) :
  "juan branco": "UCMOrzCo7Jdp6qqEX24CXuog",
};

const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Résout un handle YouTube (@nom) en channel_id (UC…). Un channel_id est renvoyé tel quel.
async function resolveChannelId(handleOrId: string): Promise<string | null> {
  if (/^UC[0-9A-Za-z_-]{22}$/.test(handleOrId)) return handleOrId;
  try {
    const r = await fetch(`https://www.youtube.com/@${handleOrId.replace(/^@/, "")}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const m = (await r.text()).match(/"(?:channelId|externalId)":"(UC[0-9A-Za-z_-]{22})"/);
    return m ? m[1] : null;
  } catch { return null; }
}

/** « il y a 3 jours », « 2 weeks ago »… → date approximative. */
function dateRelative(t: string): string | null {
  // « il y a 1 j », « il y a 3 sem. », « il y a 2 h » (abrégé, espace insécable) ou « 2 days ago ».
  const m = (t || "").replace(/ /g, " ").match(/(\d+)\s*(secondes?|seconds?|s\b|minutes?|min|heures?|hours?|h\b|jours?|days?|j\b|semaines?|sem|weeks?|mois|months?|ans?\b|years?)/i);
  if (!m) return null;
  const u = m[2].toLowerCase();
  const sec = /^s(ec|\b|$)/.test(u) ? 1 : u.startsWith("min") ? 60 : /^(h|heure|hour)/.test(u) ? 3600 : /^(j|jour|day)/.test(u) ? 86400
    : /^(sem|week)/.test(u) ? 604800 : /^(mois|month)/.test(u) ? 2592000 : 31536000;
  return new Date(Date.now() - Number(m[1]) * sec * 1000).toISOString();
}

/** Secours (et complément) : onglets « Vidéos » et « En direct » de la chaîne — les
 *  conférences et débats diffusés en direct n'apparaissent que dans le second. */
async function pageVideos(candidateId: string, channelId: string, journal = true): Promise<number> {
  const rows: any[] = [];
  const vus = new Set<string>();
  for (const onglet of ["videos", "streams"]) {
    try {
      const r = await fetch(`https://www.youtube.com/channel/${channelId}/${onglet}`, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "fr" }, signal: AbortSignal.timeout(30000) });
      const json = (await r.text()).match(/var ytInitialData = (\{.*?\});<\/script>/)?.[1];
      if (!json) continue;
      // Format 2026 : chaque vidéo est un « lockupViewModel » (identifiant, titre, « il y a … »).
      for (const bloc of json.split('"richItemRenderer"').slice(1)) {
        const id = bloc.match(/"contentId":"([\w-]{11})"/)?.[1];
        const titre = bloc.match(/"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"/)?.[1];
        const quand = bloc.match(/"content":"([^"]*?(?:il y a|ago)[^"]*)"/)?.[1];
        if (!id || !titre || vus.has(id)) continue;
        if (onglet === "streams" && !quand) continue;   // direct à venir : pas encore diffusé
        vus.add(id);
        if (rows.filter(x => x.onglet === onglet).length >= 15) continue;
        rows.push({ onglet, video_id: id, candidate_id: candidateId, title: JSON.parse(`"${titre}"`), published_at: quand ? dateRelative(quand) : null,
          url: `https://www.youtube.com/watch?v=${id}`, thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, description: null, updated_at: new Date().toISOString() });
      }
    } catch { /* onglet suivant */ }
  }
  if (!rows.length) { if (journal) console.warn(`  ! page vidéos illisible (${channelId})`); return 0; }
  // Une vidéo déjà connue garde sa date exacte (venue du RSS) : on n'ajoute que les nouvelles.
  const { data: connues } = await supabase.from("candidate_videos").select("video_id").in("video_id", rows.map(x => x.video_id));
  const neuves = rows.filter(x => !(connues || []).some((c: any) => c.video_id === x.video_id)).map(({ onglet, ...x }) => x);
  if (neuves.length) await supabase.from("candidate_videos").upsert(neuves, { onConflict: "video_id" });
  if (journal || neuves.length) console.log(`  ↪ onglets « Vidéos » / « En direct » : ${neuves.length} nouvelle(s).`);
  return neuves.length;
}

async function fetchChannel(candidateId: string, channelId: string): Promise<number> {
  const feed = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  // Le flux RSS de YouTube renvoie des 404 passagers : trois essais, puis la page « Vidéos ».
  let xml = "";
  for (let essai = 0; essai < 3 && !xml; essai++) {
    try {
      const res = await fetch(feed, { headers: { "User-Agent": "LaPolitiqueBot/1.0" }, signal: AbortSignal.timeout(30000) });
      if (res.ok) xml = await res.text(); else await new Promise(r => setTimeout(r, 2500 * (essai + 1)));
    } catch { await new Promise(r => setTimeout(r, 2500 * (essai + 1))); }
  }
  if (!xml) return pageVideos(candidateId, channelId);
  const $ = cheerio.load(xml, { xmlMode: true });
  const rows: any[] = [];
  $("entry").each((_, el) => {
    const e = $(el);
    const videoId = e.find("yt\\:videoId, videoId").first().text().trim();
    const title = e.find("title").first().text().trim();
    if (!videoId || !title) return;
    // Shorts (clips verticaux de quelques secondes) : pas dans le fil d'actualité.
    if (/\/shorts\//.test(e.find("link").first().attr("href") || "")) return;
    const published = e.find("published").first().text().trim();
    const d = published ? new Date(published) : null;
    rows.push({
      video_id: videoId, candidate_id: candidateId, title,
      published_at: d && !isNaN(d.getTime()) ? d.toISOString() : null,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      description: (e.find("media\\:description, description").first().text().trim() || "").slice(0, 800) || null,
      updated_at: new Date().toISOString(),
    });
  });
  if (rows.length) {
    const { error } = await supabase.from("candidate_videos").upsert(rows, { onConflict: "video_id" });
    if (error) { console.error(`  ! upsert: ${error.message}`); return 0; }
  }
  // Les directs (conférences, débats) manquent parfois au flux RSS : complément par les onglets.
  return rows.length + await pageVideos(candidateId, channelId, false);
}

export async function syncCandidateVideos() {
  console.log("--- SYNC FILS VIDÉO CANDIDATS (YouTube officiel) ---");
  const { data: candidates, error } = await supabase
    .from("presidential_candidates").select("id, full_name, normalized_name").eq("status", "declared");
  if (error) throw error;

  let total = 0, done = 0;
  for (const c of candidates ?? []) {
    const key = c.normalized_name || norm(c.full_name);
    const ref = CHANNELS[key] || CHANNELS[norm(c.full_name)];
    if (!ref) continue;   // pas de chaîne vérifiée → on ne fabrique rien
    const channelId = await resolveChannelId(ref);
    if (!channelId) { console.warn(`  ! chaîne non résolue pour ${c.full_name} (${ref})`); continue; }
    try {
      const n = await fetchChannel(c.id, channelId);
      console.log(`> ${c.full_name} : ${n} vidéo(s).`);
      total += n; done++;
    } catch (e: any) {
      console.warn(`  ! ${c.full_name} : ${e.message}`);
    }
  }
  console.log(`--- TERMINE. ${done} candidat(s), ${total} vidéo(s). ---`);
  return total;
}

if (process.argv[1] && process.argv[1].endsWith("sync-candidate-videos.ts")) {
  syncCandidateVideos().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
