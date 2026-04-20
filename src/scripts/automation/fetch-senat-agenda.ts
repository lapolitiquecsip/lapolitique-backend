import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SENAT_AGENDA_URL = 'https://www.senat.fr/ordre-du-jour/ordre-du-jour.html';

async function main() {
  console.log('--- SYNC SENAT AGENDA ---');

  try {
    const response = await fetch(SENAT_AGENDA_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const $ = cheerio.load(html);
    const events: any[] = [];

    $('.accordion-item').each((i, dayEl) => {
      const dateRaw = $(dayEl).find('.accordion-header .accordion-button').text().trim();
      // Date is like "Mardi 28 avril 2026"
      // We'll need a basic parser for this if we want it strictly as DATE type, 
      // otherwise we store it as title/description for now.
      
      $(dayEl).find('.accordion-body .card-title').each((j, sessionEl) => {
        const sessionTime = $(sessionEl).text().trim();
        
        // Find the next UL or P siblings until next card-title
        let next = $(sessionEl).next();
        while (next.length && !next.hasClass('card-title')) {
          if (next.is('ul')) {
            next.find('li').each((k, itemEl) => {
              const text = $(itemEl).text().trim();
              if (text) {
                events.push({
                  external_id: `senat-${dateRaw}-${sessionTime}-${k}`.replace(/\s/g, '-'),
                  date: new Date().toISOString().split('T')[0], // Fallback to today for sorting if parsing fails
                  title: `${dateRaw} - ${sessionTime}`,
                  description: text,
                  institution: 'Sénat',
                  category: 'Séance Publique',
                  type: 'Commission / Séance',
                  source_url: SENAT_AGENDA_URL
                });
              }
            });
          }
          next = next.next();
        }
      });
    });

    console.log(`> Found ${events.length} items for Senate agenda.`);

    let updatedCount = 0;
    for (const event of events) {
      const { error } = await supabase
        .from('events')
        .upsert(event, { onConflict: 'external_id' });
      if (!error) updatedCount++;
    }

    console.log(`\nTERMINE : ${updatedCount} événements du Sénat synchronisés.`);

  } catch (error) {
    console.error('Error syncing Senate agenda:', error);
  }
}

main().catch(console.error);
