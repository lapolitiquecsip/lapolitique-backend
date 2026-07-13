import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { PARTY_SEED } from '../config/political-parties.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const DATAN_DATASET = 'groupes-politiques-actifs-de-lassemblee-nationale-informations-et-statistiques';

// Découpe une ligne CSV en gérant les champs entre guillemets.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function fetchDatanRows(): Promise<Record<string, string>[]> {
  const meta = await fetch(`https://www.data.gouv.fr/api/1/datasets/${DATAN_DATASET}/`, { signal: AbortSignal.timeout(30000) });
  const ds: any = await meta.json();
  const csvRes = (ds.resources || []).find((r: any) => (r.format || '').toLowerCase() === 'csv');
  if (!csvRes) throw new Error('Ressource CSV datan introuvable');
  const res = await fetch(csvRes.url, { signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

const num = (v: string) => (v === '' || v == null ? null : Number(v));

async function main() {
  console.log('--- SYNC PARTIS (seed + datan) ---');

  // 1) Upsert des fiches (seed) — sans écraser les infos enrichies.
  for (const p of PARTY_SEED) {
    const { error } = await supabase.from('political_parties').upsert({
      slug: p.slug, name: p.name, abbrev: p.abbrev, aliases: p.aliases,
      color: p.color ?? null, datan_abbrev: p.datanAbbrev ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'slug' });
    if (error) console.error(`[seed] ${p.slug}: ${error.message}`);
  }
  console.log(`> ${PARTY_SEED.length} fiches (seed) à jour.`);

  // 2) Statistiques datan (groupes AN).
  const rows = await fetchDatanRows();
  console.log(`> ${rows.length} groupes datan récupérés.`);
  let statUpdated = 0;
  for (const p of PARTY_SEED) {
    if (!p.datanAbbrev) continue;
    const g = rows.find(r => r.libelleAbrev === p.datanAbbrev);
    if (!g) { console.log(`  (pas de groupe datan pour ${p.abbrev}=${p.datanAbbrev})`); continue; }
    const { error } = await supabase.from('political_parties').update({
      color: g.couleurAssociee || p.color || null,
      datan_group_id: g.id || null,
      effectif: num(g.effectif),
      pct_women: num(g.women),
      avg_age: num(g.age),
      score_cohesion: num(g.socreCohesion),          // (typo d'origine dans le dataset)
      score_participation: num(g.scoreParticipation),
      score_majorite: num(g.scoreMajorite),
      group_start: g.dateDebut || null,
      datan_updated_at: g.dateMaj || null,
      updated_at: new Date().toISOString(),
    }).eq('slug', p.slug);
    if (error) { console.error(`[datan] ${p.slug}: ${error.message}`); continue; }
    statUpdated++;
  }
  console.log(`> ${statUpdated} fiches enrichies des stats datan.`);
  console.log('--- TERMINE ---');
}

main().catch((e) => { console.error(e); process.exit(1); });
