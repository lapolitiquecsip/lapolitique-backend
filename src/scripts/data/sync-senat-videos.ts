import "dotenv/config";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";

// Fil vidéo du Sénat — flux RSS OFFICIEL du portail videos.senat.fr : uniquement les vraies
// vidéos institutionnelles (séances publiques, auditions, travaux de commission). Ces vidéos
// sont hébergées par le Sénat ; la carte renvoie vers la page officielle (pas d'embed YouTube).
const FEED = "https://videos.senat.fr/rss";

// Le titre RSS n'est qu'une date ; le sujet réel est dans le slug de l'URL. On le rend lisible.
const ACCENTS: [RegExp, string][] = [
  [/\bseance\b/gi, "séance"], [/\bpublique\b/gi, "publique"], [/\bapres midi\b/gi, "après-midi"],
  [/\bapres\b/gi, "après"], [/\baudition\b/gi, "audition"], [/\bcommission\b/gi, "commission"],
  [/\bdefenseur\b/gi, "défenseur"], [/\bdroits\b/gi, "droits"], [/\bdeleguee?\b/gi, "délégué"],
  [/\benquete\b/gi, "enquête"], [/\bcontrole\b/gi, "contrôle"], [/\bfinances\b/gi, "finances"],
  [/\bdeveloppement\b/gi, "développement"], [/\beconomie\b/gi, "économie"], [/\bdefense\b/gi, "défense"],
  [/\bsecurite\b/gi, "sécurité"], [/\bsante\b/gi, "santé"], [/\beducation\b/gi, "éducation"],
  [/\bgenerale\b/gi, "générale"], [/\bpolitiques?\b/gi, "politique"],
];
function titleFromUrl(url: string, fallback: string): string {
  const seg = url.split(".").pop() || "";           // dernier segment = slug
  if (!seg || /^\d/.test(seg)) return fallback;
  let t = seg.replace(/--+/g, " — ").replace(/-/g, " ").trim();
  for (const [re, r] of ACCENTS) t = t.replace(re, r);
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t || fallback;
}

export async function syncSenatVideos() {
  console.log("--- SYNC FIL VIDÉO SÉNAT (portail officiel videos.senat.fr) ---");
  const res = await fetch(FEED, { headers: { "User-Agent": "LaPolitiqueBot/1.0" }, signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`RSS Sénat HTTP ${res.status}`);
  const xml = await res.text();

  const $ = cheerio.load(xml, { xmlMode: true });
  const rows: any[] = [];
  $("entry").each((_, el) => {
    const e = $(el);
    const link = e.find("link").first().attr("href") || "";
    if (!link) return;
    // id stable = identifiant numérique de la vidéo dans l'URL (video.<ID>_<hash>.<slug>).
    const m = link.match(/video\.(\d+)_/);
    const videoId = m ? m[1] : link;
    const dateLabel = e.find("title").first().text().trim();
    const context = (e.find("summary").first().text().trim() || "").replace(/<[^>]+>/g, "").trim();
    const published = e.find("published, issued, updated").first().text().trim();
    const d = published ? new Date(published) : null;
    rows.push({
      video_id: videoId,
      title: titleFromUrl(link, dateLabel || "Vidéo du Sénat"),
      published_at: d && !isNaN(d.getTime()) ? d.toISOString() : null,
      url: link.replace(/^http:/, "https:"),
      thumbnail_url: null, // le portail du Sénat n'expose pas de vignette stable
      description: context || dateLabel || null,
      updated_at: new Date().toISOString(),
    });
  });

  console.log(`> ${rows.length} vidéos dans le flux.`);
  if (rows.length === 0) throw new Error("Flux vide — on n'écrit rien.");

  // On ne réécrit pas le titre ni la vignette des vidéos déjà complétées (voir plus bas) :
  // le flux ne donne qu'un titre reconstruit depuis l'adresse, sans accents ni majuscules.
  const { data: completes } = await supabase.from("senat_videos").select("video_id, title, thumbnail_url")
    .in("video_id", rows.map(r => r.video_id)).not("thumbnail_url", "is", null);
  // On les renvoie tels quels : une ligne sans titre fait échouer l'écriture (colonne obligatoire), même
  // si la vidéo existe déjà. Tout le fil était bloqué depuis des semaines à cause de cela.
  const dejaCompletes = new Map((completes || []).map((r: any) => [r.video_id, r]));
  for (const r of rows) { const c: any = dejaCompletes.get(r.video_id); if (c) { r.title = c.title; r.thumbnail_url = c.thumbnail_url; } }
  const neuves = rows.filter(r => !dejaCompletes.has(r.video_id));
  const connues = rows.filter(r => dejaCompletes.has(r.video_id));
  for (const lot of [neuves, connues]) {
    if (!lot.length) continue;
    const { error } = await supabase.from("senat_videos").upsert(lot, { onConflict: "video_id" });
    if (error) { console.error("[SenatVideos] upsert:", error.message); throw error; }
  }

  // Le vrai titre et la vignette sont sur la page de la vidéo (balises og:title, og:image).
  // On y va une page à la fois, sans hâte : le portail coupe les demandes rapprochées.
  const { data: aCompleter } = await supabase.from("senat_videos").select("video_id, url")
    .is("thumbnail_url", null).order("published_at", { ascending: false }).limit(Number(process.env.SENAT_VIDEOS_COMPLETER || 30));
  const entites = (t: string) => cheerio.load(`<i>${t}</i>`)("i").text().trim();
  let completees = 0;
  for (const v of aCompleter || []) {
    try {
      const r = await fetch(v.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)" }, signal: AbortSignal.timeout(30000) });
      if (r.ok) {
        const html = await r.text();
        const titre = html.match(/property="og:title"\s+content="([^"]+)"/)?.[1];
        const image = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1];
        if (titre && image) {
          await supabase.from("senat_videos").update({ title: entites(titre).slice(0, 300), thumbnail_url: image }).eq("video_id", v.video_id);
          completees++;
        }
      }
    } catch { /* la prochaine fois */ }
    await new Promise(x => setTimeout(x, 1500));
  }
  console.log(`> ${completees} vidéo(s) complétée(s) (titre officiel et vignette).`);
  console.log(`--- TERMINE. ${rows.length} vidéos. ---`);
  return rows.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-senat-videos.ts")) {
  syncSenatVideos().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
