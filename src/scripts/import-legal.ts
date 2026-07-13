import { supabase } from '../config/supabase.js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { logStart, logSuccess, logError } from '../lib/monitoring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

interface LegalRecord {
    summary: string;
    year: number;
}

async function main() {
  console.log('--- SCRAPING CASIER POLITIQUE ---');

  const hcId = process.env.HEALTHCHECK_ID_LEGAL;
  await logStart('importLegal', hcId);

  try {
    const response = await fetch('https://casier-politique.fr/');
    if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
    const html = await response.text();
    
    const jsonMatch = html.match(/parseElements\(String\.raw`([\s\S]+?)`\)/);
    if (!jsonMatch) throw new Error('Could not find data JSON');

    const rawJson = jsonMatch[1];
    let data;
    try {
        data = JSON.parse(rawJson);
    } catch (e) {
        const sanitized = rawJson.replace(/\\`/g, '`').replace(/\\\\/g, '\\');
        data = JSON.parse(sanitized);
    }

    const components = Object.values(data);
    const hemicycleComp: any = components.find((c: any) => c.tag === 'nicegui-hemicycle');

    if (!hemicycleComp || !hemicycleComp.props || !hemicycleComp.props.data) {
      throw new Error('Could not find hemicycle data');
    }

    const legalData = hemicycleComp.props.data;
    console.log(`> Found ${legalData.length} records.`);

    const recordsByName: Record<string, LegalRecord[]> = {};

    for (const record of legalData) {
      if (!record.tooltip) continue;
      
      const unescapedTooltip = record.tooltip
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');

      const $ = cheerio.load(unescapedTooltip);
      const name = $('strong').text().trim();
      const year = record.date || 0;
      
      const contentDiv = $('.content');
      let affairText = '';
      const nodes = contentDiv.contents();
      let foundStrong = false;
      for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (node.type === 'tag' && node.name === 'strong') {
              foundStrong = true;
              continue;
          }
          if (foundStrong && node.type === 'text') {
              affairText = $(node).text().trim();
              if (affairText) break;
          }
      }

      const details: string[] = [];
      contentDiv.find('b').each((i, el) => {
        const label = $(el).text().trim();
        let value = '';
        let next = el.nextSibling;
        while (next) {
            if (next.type === 'text') value += $(next).text();
            else if (next.type === 'tag' && next.name === 'br') break;
            next = next.nextSibling;
        }
        value = value.trim().replace(/^:/, '').trim();
        if (label !== 'Parti:' && value) details.push(`${label.toUpperCase()} ${value}`);
      });

      const summary = `${affairText.toUpperCase()}\n${details.join(' • ')}`;
      
      if (!recordsByName[name]) recordsByName[name] = [];
      if (!recordsByName[name].some(r => r.summary === summary)) {
          recordsByName[name].push({ summary, year });
      }
    }

    await updateTable('deputies', recordsByName);
    await updateTable('senators', recordsByName);
    await updateCandidates(recordsByName);

    console.log('\n--- TERMINE ---');
    await logSuccess('importLegal', 1, hcId, 'Legal records updated successfully.');

  } catch (error: any) {
    await logError('importLegal', error, hcId);
    throw error;
  }
}

async function updateTable(tableName: string, recordsByName: Record<string, LegalRecord[]>) {
  console.log(`\n> Updating ${tableName}...`);
  const { data: people, error } = await supabase
    .from(tableName)
    .select('id, first_name, last_name, legal_issues');

  if (error) return;

  let updatedCount = 0;
  for (const person of people || []) {
    const fullName = `${person.first_name} ${person.last_name}`.trim();
    const reverseName = `${person.last_name} ${person.first_name}`.trim();

    const records = recordsByName[fullName] || recordsByName[reverseName] || findPartialMatch(fullName, recordsByName);

    let legalStatus = "Aucune affaire judiciaire connue ou signalée à ce jour.";
    if (records && records.length > 0) {
      // Sort by year DESC
      legalStatus = records
        .sort((a, b) => b.year - a.year)
        .map(r => r.summary)
        .join('\n\n\n');
    }

    if (person.legal_issues !== legalStatus) {
        await supabase.from(tableName).update({ legal_issues: legalStatus }).eq('id', person.id);
        updatedCount++;
    }
  }
  console.log(`> ${updatedCount} profiles updated.`);
}

// Les candidats à la présidentielle n'ont qu'un champ `full_name` (pas de
// first/last séparés) → matching par nom normalisé, dans les deux sens.
async function updateCandidates(recordsByName: Record<string, LegalRecord[]>) {
  console.log(`\n> Updating presidential_candidates...`);
  const { data: candidates, error } = await supabase
    .from('presidential_candidates')
    .select('id, full_name, legal_issues');

  if (error) { console.log(`> (table presidential_candidates indisponible: ${error.message})`); return; }

  let updatedCount = 0;
  for (const candidate of candidates || []) {
    const fullName = (candidate.full_name || '').trim();
    const records =
      recordsByName[fullName] ||
      findPartialMatch(fullName, recordsByName);

    let legalStatus = "Aucune affaire judiciaire connue ou signalée à ce jour.";
    if (records && records.length > 0) {
      legalStatus = records
        .sort((a, b) => b.year - a.year)
        .map(r => r.summary)
        .join('\n\n\n');
    }

    if (candidate.legal_issues !== legalStatus) {
      await supabase.from('presidential_candidates').update({ legal_issues: legalStatus }).eq('id', candidate.id);
      updatedCount++;
    }
  }
  console.log(`> ${updatedCount} candidate profiles updated.`);
}

function findPartialMatch(fullName: string, recordsByName: Record<string, LegalRecord[]>): LegalRecord[] | null {
    const normalizedFull = normalize(fullName);
    for (const name in recordsByName) {
        if (normalize(name) === normalizedFull) return recordsByName[name];
    }
    return null;
}

function normalize(str: string): string {
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
}

main().catch(console.error);
