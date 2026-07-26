import "dotenv/config";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";

// Fil vidéo du Sénat — flux RSS de la chaîne YouTube officielle Public Sénat (séances,
// questions au Gouvernement, auditions). Libre, sans clé API. Chaîne configurable via
// SENAT_YT_CHANNEL (id UC…) ; sinon nom hérité « publicsenat ».
const CHANNEL_ID = process.env.SENAT_YT_CHANNEL || "";
const FEED = CHANNEL_ID
  ? `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`
  : `https://www.youtube.com/feeds/videos.xml?user=publicsenat`;

export async function syncSenatVideos() {
  console.log("--- SYNC FIL VIDÉO SÉNAT (YouTube Public Sénat) ---");
  const res = await fetch(FEED, { headers: { "User-Agent": "LaPolitiqueBot/1.0" }, signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`YouTube RSS HTTP ${res.status}`);
  const xml = await res.text();

  const $ = cheerio.load(xml, { xmlMode: true });
  const rows: any[] = [];
  $("entry").each((_, el) => {
    const e = $(el);
    const videoId = e.find("yt\\:videoId, videoId").first().text().trim();
    const title = e.find("title").first().text().trim();
    if (!videoId || !title) return;
    const published = e.find("published").first().text().trim();
    const d = published ? new Date(published) : null;
    rows.push({
      video_id: videoId,
      title,
      published_at: d && !isNaN(d.getTime()) ? d.toISOString() : null,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      description: (e.find("media\\:description, description").first().text().trim() || "").slice(0, 800) || null,
      updated_at: new Date().toISOString(),
    });
  });

  console.log(`> ${rows.length} vidéos dans le flux.`);
  if (rows.length === 0) throw new Error("Flux vide — on n'écrit rien.");

  const { error } = await supabase.from("senat_videos").upsert(rows, { onConflict: "video_id" });
  if (error) { console.error("[SenatVideos] upsert:", error.message); throw error; }
  console.log(`--- TERMINE. ${rows.length} vidéos. ---`);
  return rows.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-senat-videos.ts")) {
  syncSenatVideos().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
