import "dotenv/config";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";

// Fil vidéo de la présidence — flux RSS de la chaîne YouTube officielle de l'Élysée.
// Libre, sans clé d'API, sans quota : YouTube expose ce flux pour toute chaîne publique.
// On ne stocke que des métadonnées (titre, date, id) ; la vidéo reste lue chez YouTube
// via l'embed officiel, ce qui est l'usage prévu et respecte les droits.
const CHANNEL_ID = process.env.ELYSEE_YT_CHANNEL || "UCPaeEhnVIdn4T01gUphIltw";
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

export async function syncElyseeVideos() {
  console.log("--- SYNC FIL VIDÉO ÉLYSÉE (YouTube officiel) ---");
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
      // Vignette servie par YouTube : pas de copie chez nous.
      thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      description: (e.find("media\\:description, description").first().text().trim() || "").slice(0, 800) || null,
      updated_at: new Date().toISOString(),
    });
  });

  console.log(`> ${rows.length} vidéos dans le flux.`);
  if (rows.length === 0) throw new Error("Flux vide — on n'écrit rien.");

  const { error } = await supabase.from("elysee_videos").upsert(rows, { onConflict: "video_id" });
  if (error) { console.error("[ElyseeVideos] upsert:", error.message); throw error; }
  console.log(`--- TERMINE. ${rows.length} vidéos. ---`);
  return rows.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-elysee-videos.ts")) {
  syncElyseeVideos().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
