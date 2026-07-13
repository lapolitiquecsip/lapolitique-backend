import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { resilientDeepSeek } from '../lib/deepseek-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const ENRICH_VERSION = 1; // incrémenter pour forcer un ré-enrichissement

const WIKI_HEADERS = { 'User-Agent': 'LaPolitiqueBot/1.0 (contact@lapolitique.fr)' };

async function wikipedia(title: string): Promise<{ extract: string; url?: string; logo?: string }> {
  try {
    const res = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      headers: WIKI_HEADERS, signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { extract: '' };
    const data: any = await res.json();
    let extract = data.extract || '';
    try {
      const full = await fetch(
        `https://fr.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(data.title || title)}`,
        { headers: WIKI_HEADERS, signal: AbortSignal.timeout(12000) },
      );
      if (full.ok) {
        const json: any = await full.json();
        const page: any = Object.values(json?.query?.pages ?? {})[0];
        if (page?.extract && page.extract.length > extract.length) extract = page.extract;
      }
    } catch { /* repli sur le résumé court */ }
    return { extract, url: data.content_urls?.desktop?.page, logo: data.originalimage?.source || data.thumbnail?.source };
  } catch { return { extract: '' }; }
}

async function structure(name: string, reference: string) {
  const response = await resilientDeepSeek.createMessage({
    model: 'deepseek-v4-flash',
    max_tokens: 900,
    responseFormat: 'json_object',
    system: `Tu es un documentaliste politique. À partir du TEXTE de référence (Wikipédia) sur un parti politique français, tu extrais des informations factuelles.

Réponds UNIQUEMENT en JSON avec ces clés (chaîne de caractères ; "" si l'info est absente du texte, n'invente RIEN) :
{
  "summary": "2-3 phrases neutres présentant le parti",
  "founded": "année ou date de fondation (ex. '1972')",
  "members": "nombre d'adhérents avec l'année si connue (ex. 'env. 40 000 (2023)')",
  "budget": "budget ou ressources financières annuelles si mentionné",
  "leader": "dirigeant·e actuel·le (président·e / premier·ère secrétaire)",
  "orientation": "positionnement politique (ex. 'Extrême droite', 'Gauche', 'Centre')",
  "headquarters": "ville du siège",
  "website": "site officiel (URL) si mentionné"
}`,
    messages: [{ role: 'user', content: `Parti : ${name}\n\nTEXTE :\n${reference.slice(0, 6000)}` }],
  }, { timeoutMs: 60000 });

  const raw = response.content?.[0]?.text?.trim() || '';
  try {
    const jsonStr = raw.startsWith('{') ? raw : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    return JSON.parse(jsonStr);
  } catch {
    console.warn(`  JSON invalide pour ${name}`);
    return null;
  }
}

async function main() {
  console.log('--- ENRICHISSEMENT PARTIS (Wikipédia + IA) ---');
  const { data: parties, error } = await supabase
    .from('political_parties')
    .select('slug, name, bio, aliases');
  if (error) throw error;

  // Récupère les titres Wikipédia depuis le seed (via import dynamique pour rester découplé).
  const { PARTY_SEED } = await import('../config/political-parties.js');
  const wikiBySlug = new Map(PARTY_SEED.map(p => [p.slug, p.wikipedia]));

  let done = 0;
  for (const party of parties || []) {
    if ((party.bio as any)?._v === ENRICH_VERSION) continue; // déjà enrichi
    const title = wikiBySlug.get(party.slug) || party.name;
    try {
      const wiki = await wikipedia(title);
      if (!wiki.extract) { console.log(`  (pas de Wikipédia pour ${party.name})`); continue; }
      const info = await structure(party.name, wiki.extract);
      if (!info) continue;
      const { error: upErr } = await supabase.from('political_parties').update({
        summary: info.summary || null,
        founded: info.founded || null,
        members: info.members || null,
        budget: info.budget || null,
        leader: info.leader || null,
        orientation: info.orientation || null,
        headquarters: info.headquarters || null,
        website: info.website || null,
        logo_url: wiki.logo || null,
        source_url: wiki.url || null,
        bio: { _v: ENRICH_VERSION },
        enriched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('slug', party.slug);
      if (upErr) { console.error(`  update ${party.slug}: ${upErr.message}`); continue; }
      done++;
      console.log(`> ✓ ${party.name}`);
    } catch (e: any) {
      console.error(`  échec ${party.name}: ${e.message}`);
    }
  }
  console.log(`\n--- TERMINE. ${done} parti(s) enrichi(s). ---`);
}

main().catch((e) => { console.error(e); process.exit(1); });
