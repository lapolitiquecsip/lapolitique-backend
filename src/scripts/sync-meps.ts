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

// Le PE écrit le NOM DE FAMILLE en majuscules : « Grégory ALLIONE ». On sépare prénom/nom
// sur cette base pour l'affichage et le rapprochement Wikipédia.
function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  const lastIdx = parts.findIndex(p => p.length > 1 && p === p.toUpperCase() && /[A-ZÀ-Ÿ]/.test(p));
  if (lastIdx <= 0) return { first: parts.slice(0, -1).join(" "), last: parts.slice(-1).join(" ") };
  const first = parts.slice(0, lastIdx).join(" ");
  const last = parts.slice(lastIdx).join(" ");
  // Nom en Casse Titre pour l'affichage.
  const titled = last.split(/(\s|-)/).map(w => /^[\s-]$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()).join("");
  return { first, last: titled };
}

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// Codes de groupe EP courts, pour les couleurs côté front.
function groupCode(g: string): string {
  const t = (g || "").toLowerCase();
  if (t.includes("renew")) return "RE";
  if (t.includes("populaire") || t.includes("ppe")) return "PPE";
  if (t.includes("socialiste") || t.includes("s&d") || t.includes("democrat")) return "SD";
  if (t.includes("verts") || t.includes("green")) return "VERTS";
  if (t.includes("patriot")) return "PfE";
  if (t.includes("conservateur") || t.includes("ecr")) return "ECR";
  if (t.includes("gauche") || t.includes("left")) return "GUE";
  if (t.includes("souverain") || t.includes("esn")) return "ESN";
  return "NI";
}

async function main() {
  console.log('--- SYNC EURODÉPUTÉS (Parlement européen) ---');
  const res = await fetch('https://www.europarl.europa.eu/meps/fr/full-list/xml/', {
    headers: { 'User-Agent': 'LaPolitiqueBot/1.0 (contact@lapolitique.fr)' }, signal: AbortSignal.timeout(30000),
  });
  const xml = await res.text();
  const blocks = [...xml.matchAll(/<mep>([\s\S]*?)<\/mep>/g)].map(m => m[1]);
  const french = blocks.filter(b => field(b, 'country') === 'France');
  console.log(`> ${french.length} eurodéputés français.`);

  // Slugs uniques (deux homonymes possibles → on suffixe par l'id).
  const seen = new Set<string>();
  let n = 0;
  for (const b of french) {
    const id = field(b, 'id');
    if (!id) continue;
    const fullName = field(b, 'fullName');
    const epGroup = field(b, 'politicalGroup') || null;
    const { first, last } = splitName(fullName);
    let slug = slugify(`${first} ${last}`);
    if (seen.has(slug)) slug = `${slug}-${id}`;
    seen.add(slug);
    const { error } = await supabase.from('meps').upsert({
      id,
      full_name: `${first} ${last}`.trim() || fullName,
      first_name: first || null,
      last_name: last || null,
      slug,
      photo_url: `https://www.europarl.europa.eu/mepphoto/${id}.jpg`,
      national_party: field(b, 'nationalPoliticalGroup') || null,
      ep_group: epGroup,
      ep_group_code: groupCode(epGroup || ""),
      country: 'France',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) { console.error(`  ${id}: ${error.message}`); continue; }
    n++;
  }
  console.log(`--- TERMINE. ${n} eurodéputés à jour. ---`);
}

main().catch((e) => { console.error(e); process.exit(1); });
