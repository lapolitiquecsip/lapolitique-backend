import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { resilientDeepSeek } from '../lib/deepseek-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const ENRICH_VERSION = 4; // incrémenter pour forcer un ré-enrichissement (v4 = + idéologie & réseaux sociaux)

const WIKI_HEADERS = { 'User-Agent': 'LaPolitiqueBot/1.0 (contact@lapolitique.fr)' };

async function wikipedia(title: string): Promise<{ extract: string; url?: string; logo?: string; qid?: string }> {
  try {
    const res = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      headers: WIKI_HEADERS, signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { extract: '' };
    const data: any = await res.json();
    if (data.type === 'disambiguation') return { extract: '' };
    let extract = data.extract || '';
    let qid: string | undefined;
    try {
      const full = await fetch(
        `https://fr.wikipedia.org/w/api.php?action=query&prop=extracts|pageprops&ppprop=wikibase_item&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(data.title || title)}`,
        { headers: WIKI_HEADERS, signal: AbortSignal.timeout(12000) },
      );
      if (full.ok) {
        const json: any = await full.json();
        const page: any = Object.values(json?.query?.pages ?? {})[0];
        if (page?.extract && page.extract.length > extract.length) extract = page.extract;
        qid = page?.pageprops?.wikibase_item;
      }
    } catch { /* repli sur le résumé court */ }
    return { extract, qid, url: data.content_urls?.desktop?.page, logo: data.originalimage?.source || data.thumbnail?.source };
  } catch { return { extract: '' }; }
}

// Données structurées Wikidata : fondation (P571), adhérents (P2124), siège (P159), logo (P154).
async function wikidata(qid: string): Promise<{ founded?: string; members?: string; headquarters?: string; logo?: string; twitter?: string; facebook?: string; instagram?: string; youtube?: string; tiktok?: string }> {
  try {
    const res = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, {
      headers: WIKI_HEADERS, signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return {};
    const json: any = await res.json();
    const claims = json?.entities?.[qid]?.claims || {};
    const out: { founded?: string; members?: string; headquarters?: string; logo?: string;
      twitter?: string; facebook?: string; instagram?: string; youtube?: string; tiktok?: string } = {};

    // P154 — logo (fichier Commons) → URL via Special:FilePath
    const logoFile = claims.P154?.[0]?.mainsnak?.datavalue?.value;
    if (logoFile) out.logo = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(logoFile)}?width=240`;

    // Réseaux sociaux officiels (identifiants Wikidata → URL) : pour que l'utilisateur suive le parti.
    const id = (p: string) => claims[p]?.[0]?.mainsnak?.datavalue?.value as string | undefined;
    const tw = id('P2002'); if (tw) out.twitter = `https://x.com/${tw}`;
    const fb = id('P2013'); if (fb) out.facebook = `https://www.facebook.com/${fb}`;
    const ig = id('P2003'); if (ig) out.instagram = `https://www.instagram.com/${ig}`;
    const yt = id('P2397'); if (yt) out.youtube = `https://www.youtube.com/channel/${yt}`;
    const tk = id('P7085'); if (tk) out.tiktok = `https://www.tiktok.com/@${tk.replace(/^@/, '')}`;

    // P571 — date de fondation
    const inception = claims.P571?.[0]?.mainsnak?.datavalue?.value?.time;
    if (inception) { const m = inception.match(/([0-9]{4})/); if (m) out.founded = m[1]; }

    // P2124 — nombre d'adhérents (prendre la valeur la plus récente via P585)
    const memberClaims = (claims.P2124 || []).filter((c: any) => c?.mainsnak?.datavalue?.value?.amount);
    if (memberClaims.length) {
      memberClaims.sort((a: any, b: any) => {
        const ya = a.qualifiers?.P585?.[0]?.datavalue?.value?.time || '';
        const yb = b.qualifiers?.P585?.[0]?.datavalue?.value?.time || '';
        return yb.localeCompare(ya);
      });
      const best = memberClaims[0];
      const amount = String(best.mainsnak.datavalue.value.amount).replace(/^\+/, '');
      const year = (best.qualifiers?.P585?.[0]?.datavalue?.value?.time || '').match(/([0-9]{4})/)?.[1];
      const n = Number(amount);
      out.members = `${isNaN(n) ? amount : n.toLocaleString('fr-FR')}${year ? ` (${year})` : ''}`;
    }

    // P159 — siège (item → libellé fr)
    const hqId = claims.P159?.[0]?.mainsnak?.datavalue?.value?.id;
    if (hqId) {
      try {
        const lr = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${hqId}&props=labels&languages=fr&format=json`, {
          headers: WIKI_HEADERS, signal: AbortSignal.timeout(12000),
        });
        if (lr.ok) { const lj: any = await lr.json(); out.headquarters = lj?.entities?.[hqId]?.labels?.fr?.value; }
      } catch { /* siège optionnel */ }
    }
    return out;
  } catch { return {}; }
}

async function structure(name: string, reference: string) {
  const response = await resilientDeepSeek.createMessage({
    model: 'deepseek-v4-flash',
    max_tokens: 900,
    responseFormat: 'json_object',
    system: `Tu es un documentaliste politique. À partir du TEXTE de référence (Wikipédia) sur un parti politique français, tu extrais des informations factuelles.

Réponds UNIQUEMENT en JSON avec ces clés (n'invente RIEN ; "" ou [] si l'info est absente du texte) :
{
  "summary": "2-3 phrases neutres présentant le parti",
  "founded": "année ou date de fondation (ex. '1972')",
  "members": "nombre d'adhérents avec l'année si connue (ex. 'env. 40 000 (2023)')",
  "budget": "budget ou ressources financières annuelles si mentionné",
  "leader": "dirigeant·e actuel·le (président·e / premier·ère secrétaire)",
  "orientation": "positionnement sur l'axe politique (ex. 'Extrême droite', 'Gauche', 'Centre')",
  "headquarters": "ville du siège",
  "website": "site officiel (URL) si mentionné",
  "ideology": ["liste de 3 à 6 COURANTS ou VALEURS idéologiques du parti tels qu'énoncés dans le texte (ex. 'Écologie politique', 'Souverainisme', 'Social-démocratie', 'Libéralisme économique', 'Féminisme'). NEUTRE : n'inclus PAS de qualificatif péjoratif ou attribué par des adversaires (ex. 'xénophobie', 'racisme', 'extrémisme', 'complotisme'), ni de simples THÈMES qui ne sont pas des idéologies (ex. 'Europe', 'Démocratie', 'Environnement', 'Démographie', 'Technologie', 'Géopolitique')."]
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
      // Wikidata (structuré) prioritaire pour fondation / adhérents / siège.
      const wd = wiki.qid ? await wikidata(wiki.qid) : {};
      const { error: upErr } = await supabase.from('political_parties').update({
        summary: info.summary || null,
        founded: wd.founded || info.founded || null,
        members: wd.members || info.members || null,
        budget: info.budget || null,
        leader: info.leader || null,
        orientation: info.orientation || null,
        headquarters: wd.headquarters || info.headquarters || null,
        website: info.website || null,
        ideology: Array.isArray(info.ideology) && info.ideology.length ? info.ideology.slice(0, 6) : null,
        twitter: wd.twitter || null,
        facebook: wd.facebook || null,
        instagram: wd.instagram || null,
        youtube: wd.youtube || null,
        tiktok: wd.tiktok || null,
        logo_url: wd.logo || wiki.logo || null,
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
