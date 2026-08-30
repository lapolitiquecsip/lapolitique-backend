import "dotenv/config";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";

// Fil vidéo par candidat à la présidentielle 2027 — flux RSS des chaînes YouTube OFFICIELLES
// (libre, sans clé, sans quota). On ne stocke que des métadonnées ; la vidéo reste lue chez
// YouTube via l'embed officiel. AUCUNE donnée inventée : uniquement des chaînes VÉRIFIÉES.
//
// Pour ajouter un candidat : vérifier sa chaîne (youtube.com/@handle → id UC…), tester le flux
// https://www.youtube.com/feeds/videos.xml?channel_id=UC… puis l'ajouter ci-dessous.
const CHANNELS: Record<string, string> = {
  // clé = normalized_name du candidat (minuscules, sans accents)
  "david lisnard": "UC2XZY-bjIEmyLZ9MPJQytZg",   // vérifié (youtube.com/davidlisnard)
};

const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

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
    const channelId = CHANNELS[key] || CHANNELS[norm(c.full_name)];
    if (!channelId) continue;   // pas de chaîne vérifiée → on ne fabrique rien
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
