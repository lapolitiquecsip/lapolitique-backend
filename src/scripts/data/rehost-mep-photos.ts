import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Re-héberge les photos officielles des eurodéputés (europarl) sur Supabase Storage. L'endpoint
// europarl `mepphoto/{id}.jpg` répond de façon INTERMITTENTE (202 vide à froid, 200 une fois
// réchauffé) → en hotlink direct le navigateur retombe sur des initiales. On les fetch côté serveur
// (retries pour passer le 202) puis on les sert depuis notre CDN, fiable et instantané.
//   Usage : npm run data:rehost-mep-photos
const BUCKET = "mep-photos";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchPhoto(url: string): Promise<Buffer | null> {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "Accept-Language": "fr-FR,fr;q=0.9",
          "Referer": "https://www.europarl.europa.eu/",
          "Sec-Fetch-Dest": "image", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Site": "same-origin",
        },
        signal: AbortSignal.timeout(20000),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") || "";
      if (res.status === 200 && ct.startsWith("image") && buf.length > 500) return buf;
    } catch { /* réessaie */ }
    await sleep(600 * attempt); // backoff : le temps que le cache europarl se réchauffe
  }
  return null;
}

async function main() {
  // bucket public (créé si absent)
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some(b => b.name === BUCKET)) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message)) throw error;
    console.log(`Bucket ${BUCKET} créé.`);
  }

  const { data: meps, error } = await supabase.from("meps").select("id,full_name,photo_url");
  if (error) throw error;
  console.log(`${meps?.length ?? 0} eurodéputés à traiter.`);

  let ok = 0, fail = 0;
  for (const m of meps ?? []) {
    // ne re-héberge que ceux encore en URL europarl (idempotent, relançable)
    if (!m.photo_url || !/europarl\.europa\.eu/.test(m.photo_url)) { continue; }
    const buf = await fetchPhoto(m.photo_url);
    if (!buf) { console.warn(`  ✗ ${m.full_name} : photo europarl inaccessible`); fail++; continue; }
    const epId = m.photo_url.match(/mepphoto\/(\d+)/)?.[1] || m.id;
    const path = `${epId}.jpg`;
    const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: "image/jpeg", upsert: true });
    if (up.error) { console.warn(`  ✗ ${m.full_name} : upload ${up.error.message}`); fail++; continue; }
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    await supabase.from("meps").update({ photo_url: pub.publicUrl }).eq("id", m.id);
    ok++;
    if (ok % 10 === 0) console.log(`  … ${ok} re-hébergées`);
    await sleep(150);
  }
  console.log(`\nTerminé : ${ok} photos re-hébergées, ${fail} échecs (restent en europarl → repli initiales).`);
}

main().catch(e => { console.error(e); process.exit(1); });
