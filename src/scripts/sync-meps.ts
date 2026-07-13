import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const field = (block: string, tag: string) =>
  (block.match(new RegExp(`<${tag}>(.*?)</${tag}>`))?.[1] || '').trim();

async function main() {
  console.log('--- SYNC EURODÉPUTÉS (Parlement européen) ---');
  const res = await fetch('https://www.europarl.europa.eu/meps/fr/full-list/xml/', {
    headers: { 'User-Agent': 'LaPolitiqueBot/1.0 (contact@lapolitique.fr)' }, signal: AbortSignal.timeout(30000),
  });
  const xml = await res.text();
  const blocks = [...xml.matchAll(/<mep>([\s\S]*?)<\/mep>/g)].map(m => m[1]);
  const french = blocks.filter(b => field(b, 'country') === 'France');
  console.log(`> ${french.length} eurodéputés français.`);

  let n = 0;
  for (const b of french) {
    const id = field(b, 'id');
    if (!id) continue;
    const { error } = await supabase.from('meps').upsert({
      id,
      full_name: field(b, 'fullName'),
      national_party: field(b, 'nationalPoliticalGroup') || null,
      ep_group: field(b, 'politicalGroup') || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) { console.error(`  ${id}: ${error.message}`); continue; }
    n++;
  }
  console.log(`--- TERMINE. ${n} eurodéputés à jour. ---`);
}

main().catch((e) => { console.error(e); process.exit(1); });
