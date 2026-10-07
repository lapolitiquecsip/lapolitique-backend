import "dotenv/config";
import { supabase } from "../../config/supabase.js";

/**
 * Retire les Shorts YouTube déjà enregistrés : l'adresse youtube.com/shorts/ID répond 200
 * pour un Short et redirige (303) vers la page de la vidéo pour une vidéo ordinaire.
 */
async function estShort(id: string): Promise<boolean> {
  try {
    const r = await fetch(`https://www.youtube.com/shorts/${id}`, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0", Cookie: "SOCS=CAI; CONSENT=YES+" }, signal: AbortSignal.timeout(15000) });   // sans le cookie, la page de consentement européenne répond à tout
    return r.status === 200;
  } catch { return false; }
}

async function main() {
  const { data } = await supabase.from("candidate_videos").select("video_id, title");
  const shorts: string[] = [];
  for (const v of data || []) { if (await estShort(v.video_id)) shorts.push(v.video_id); }
  for (let i = 0; i < shorts.length; i += 100) await supabase.from("candidate_videos").delete().in("video_id", shorts.slice(i, i + 100));
  console.log(`[Shorts] ${shorts.length} retiré(s) sur ${(data || []).length} vidéo(s).`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
