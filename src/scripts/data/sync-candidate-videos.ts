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
  "jean luc melenchon": "UCKHKSD-yanY2ZwwU_4Tgf0w", // @JLMelenchon
  "marine le pen": "UCU3z3px1_RCqYBwrs8LJVWg",      // @MarineLePenOfficiel
  "francois ruffin": "UCIQGSp79vVch0vO3Efqif_w",    // @Francois_Ruffin
  "raphael glucksmann": "UCFkJQynKi4CrOUk6RUq680A", // @placepublique (son mouvement)
  "bruno retailleau": "UC3Ma4tRFxx85oZI_XKVTPwg",   // @lesRepublicains (son parti)
  "florian philippot": "UCHnjsXnEIOUwKYu4_DtzMgw",  // @LesPatriotesOfficiel (son mouvement)
  "francois asselineau": "UClT42CQ0kwYup0yyRdTJZVg",// @upr (son mouvement)
  "marine tondelier": "UC9hpwLJwVqEFMaE0HGN9_zg",   // @EELV (son parti)
  "delphine batho": "UC05b-o8l5MzSWw-NeVOZtgw",     // @GenerationEcologie (son parti)
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

async function fetchChannel(candidateId: string, channelId: string): Promise<number> {
  const feed = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(feed, { headers: { "User-Agent": "LaPolitiqueBot/1.0" }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) { console.warn(`  ! RSS HTTP ${res.status} (${channelId})`); return 0; }
  const $ = cheerio.load(await res.text(), { xmlMode: true });
  const rows: any[] = [];
  $("entry").each((_, el) => {
    const e = $(el);
    const videoId = e.find("yt\\:videoId, videoId").first().text().trim();
    const title = e.find("title").first().text().trim();
    if (!videoId || !title) return;
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
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("candidate_videos").upsert(rows, { onConflict: "video_id" });
  if (error) { console.error(`  ! upsert: ${error.message}`); return 0; }
  return rows.length;
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
