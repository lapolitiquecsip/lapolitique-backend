import { supabase } from '../../config/supabase.js';
import * as dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { parseFrenchDate } from './utils.js';
import { logError } from '../../lib/monitoring.js';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const SENAT_AGENDA_URL = 'https://www.senat.fr/ordre-du-jour/ordre-du-jour.html';

function generateDeterministicUUID(input: string): string {
  const hash = crypto.createHash('sha1').update(input).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export async function main() {
  console.log('--- SYNC SENAT AGENDA ---');

  const hcId = process.env.HEALTHCHECK_ID_AGENDA;
  try {
    const response = await fetch(SENAT_AGENDA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const $ = cheerio.load(html);
    const events: any[] = [];

    $('.accordion-item').each((i, dayEl) => {
      const dateRaw = $(dayEl).find('.accordion-header .accordion-button').text().trim();
      const isoDate = parseFrenchDate(dateRaw);
      
      $(dayEl).find('.timeline-item').each((j, eventEl) => {
        const sessionTime = $(eventEl).find('.timeline-title').text().trim();
        const body = $(eventEl).find('.timeline-body');
        
        // Clean description: join all paragraphs and list items
        const paragraphs: string[] = [];
        body.find('p, li').each((_, el) => {
          const txt = $(el).text().trim();
          if (txt) paragraphs.push(txt);
        });
        
        const description = paragraphs.join('\n');
        
        // Improve title: [Time] - [First paragraph]
        const firstLine = paragraphs[0] || '';
        let title = sessionTime ? `[${sessionTime}] ${firstLine}` : (firstLine || 'Séance');
        
        // Limit title length for DB
        // No truncation needed for title

        if (description) {
          const externalId = `senat-${isoDate}-${sessionTime}-${description.slice(0, 30)}`;
          events.push({
            id: generateDeterministicUUID(externalId),
            date: isoDate,
            title: title,
            description: description,
            institution: 'Sénat',
            category: 'Séance Publique',
            source_url: SENAT_AGENDA_URL
          });
        }
      });
    });

    console.log(`> Found ${events.length} items for Senat agenda.`);

    let updatedCount = 0;
    for (const event of events) {
      const { error } = await supabase
        .from('events')
        .upsert(event, { onConflict: 'id' });
      if (!error) updatedCount++;
      else console.error(`Error for ${event.id}:`, error.message);
    }

    console.log(`\nTERMINE : ${updatedCount} événements du Sénat synchronisés.`);

  } catch (error: any) {
    await logError('fetchSenatAgenda', error, hcId);
    throw error;
  }
}

const nodePath = fs.realpathSync(process.argv[1]);
const currentPath = fileURLToPath(import.meta.url);
if (nodePath === currentPath || nodePath.endsWith('fetch-senat-agenda.ts') || nodePath.endsWith('fetch-senat-agenda.js')) {
  main().catch(console.error);
}
