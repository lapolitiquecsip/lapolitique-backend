import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { resilientDeepSeek } from '../lib/deepseek-client.js';
import { PARTY_SEED } from '../config/political-parties.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const H = { 'User-Agent': 'LaPolitiqueBot/1.0 (contact@lapolitique.fr)' };

type Row = { party_slug: string; kind: string; year: number; value: number | null; label: string; source: string };

async function wiki(title: string): Promise<{ extract: string; qid?: string }> {
  try {
    const s = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: H, signal: AbortSignal.timeout(12000) });
    if (!s.ok) return { extract: '' };
    const d: any = await s.json();
    if (d.type === 'disambiguation') return { extract: '' };
    let extract = d.extract || '';
    let qid: string | undefined;
    try {
      const f = await fetch(`https://fr.wikipedia.org/w/api.php?action=query&prop=extracts|pageprops&ppprop=wikibase_item&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(d.title || title)}`, { headers: H, signal: AbortSignal.timeout(12000) });
      if (f.ok) { const j: any = await f.json(); const p: any = Object.values(j?.query?.pages ?? {})[0]; if (p?.extract) extract = p.extract; qid = p?.pageprops?.wikibase_item; }
    } catch { /* repli */ }
    return { extract, qid };
  } catch { return { extract: '' }; }
}

// Série d'adhérents (Wikidata P2124, tous les points avec année P585) — vérifié.
async function membersSeries(qid: string, slug: string): Promise<Row[]> {
  try {
    const r = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, { headers: H, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const j: any = await r.json();
    const claims = (j?.entities?.[qid]?.claims?.P2124) || [];
    const rows: Row[] = [];
    for (const c of claims) {
      const amount = c?.mainsnak?.datavalue?.value?.amount;
      const year = (c?.qualifiers?.P585?.[0]?.datavalue?.value?.time || '').match(/([0-9]{4})/)?.[1];
      if (amount && year) rows.push({ party_slug: slug, kind: 'adherents', year: Number(year), value: Number(String(amount).replace(/^\+/, '')), label: '', source: 'wikidata' });
    }
    return rows;
  } catch { return []; }
}

// Résultats électoraux extraits du texte Wikipédia (mix : IA ancrée sur la source).
async function electionSeries(name: string, extract: string, slug: string): Promise<Row[]> {
  const resp = await resilientDeepSeek.createMessage({
    model: 'deepseek-v4-flash',
    max_tokens: 1200,
    responseFormat: 'json_object',
    system: `Tu extrais des résultats électoraux d'un parti politique français À PARTIR du TEXTE fourni (Wikipédia). N'invente RIEN : n'utilise que des chiffres présents dans le texte.

Réponds en JSON : { "results": [ { "kind": "presidentielle|legislatives|europeennes|senatoriales", "year": 2022, "score": 23.1, "label": "1er tour" } ] }
- "score" = pourcentage national de voix (nombre, sans %). Omets l'entrée si le pourcentage n'est pas dans le texte.
- "label" : "1er tour", "2e tour" ou "" si non précisé.
- Retourne un tableau vide si aucun résultat chiffré fiable.`,
    messages: [{ role: 'user', content: `Parti : ${name}\n\nTEXTE :\n${extract.slice(0, 22000)}` }],
  }, { timeoutMs: 60000 });
  const raw = resp.content?.[0]?.text?.trim() || '';
  try {
    const j = JSON.parse(raw.startsWith('{') ? raw : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const out: Row[] = [];
    for (const r of j.results || []) {
      const kind = String(r.kind || '');
      const year = Number(r.year);
      const score = Number(r.score);
      if (!['presidentielle', 'legislatives', 'europeennes', 'senatoriales'].includes(kind)) continue;
      if (!year || isNaN(score)) continue;
      out.push({ party_slug: slug, kind, year, value: score, label: String(r.label || ''), source: 'wikipedia' });
    }
    return out;
  } catch { return []; }
}

async function main() {
  console.log('--- HISTORIQUE PARTIS (adhérents Wikidata + élections IA) ---');
  const wikiBySlug = new Map(PARTY_SEED.map(p => [p.slug, p.wikipedia]));
  const { data: parties } = await supabase.from('political_parties').select('slug, name, members');

  for (const p of parties || []) {
    const title = wikiBySlug.get(p.slug) || p.name;
    const { extract, qid } = await wiki(title);
    if (!extract) { console.log(`  (pas de Wikipédia pour ${p.name})`); continue; }
    const rows: Row[] = [];
    if (qid) rows.push(...await membersSeries(qid, p.slug));
    // Point d'adhérents récent issu du champ enrichi (ex. "100 000 (2024)").
    // Année obligatoire ; le nombre = tous les chiffres hors année.
    const ymatch = (p.members || '').match(/\b(19\d{2}|20\d{2})\b/);
    if (ymatch) {
      const yr = Number(ymatch[1]);
      const digits = (p.members || '').replace(ymatch[0], ' ').replace(/[^\d]/g, '');
      const val = digits ? Number(digits) : 0;
      if (val >= 1000 && !rows.some(r => r.kind === 'adherents' && r.year === yr)) {
        rows.push({ party_slug: p.slug, kind: 'adherents', year: yr, value: val, label: '', source: 'wikidata' });
      }
    }
    try { rows.push(...await electionSeries(p.name, extract, p.slug)); } catch (e: any) { console.error(`  élections ${p.name}: ${e.message}`); }

    if (!rows.length) { console.log(`  (aucune donnée pour ${p.name})`); continue; }
    // Remplace proprement l'historique du parti (évolue avec la source).
    await supabase.from('party_history').delete().eq('party_slug', p.slug);
    // Déduplique sur la clé primaire (slug, kind, year, label).
    const seen = new Set<string>();
    const uniq = rows.filter(r => { const k = `${r.kind}|${r.year}|${r.label}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const { error } = await supabase.from('party_history').insert(uniq);
    if (error) { console.error(`  insert ${p.name}: ${error.message}`); continue; }
    console.log(`> ✓ ${p.name} : ${uniq.length} points`);
  }
  console.log('--- TERMINE ---');
}

main().catch((e) => { console.error(e); process.exit(1); });
