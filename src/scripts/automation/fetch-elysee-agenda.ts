import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { parseFrenchDate } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ELYSEE_AGENDA_URL = 'https://www.elysee.fr/agenda';

function generateDeterministicUUID(input: string): string {
  const hash = crypto.createHash('sha1').update(input).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function main() {
  console.log('--- SYNC ELYSEE AGENDA ---');

  try {
    const response = await fetch(ELYSEE_AGENDA_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const $ = cheerio.load(html);
    const events: any[] = [];

    $('section.container').each((i, section) => {
      // Date sticker usually contains: Day (text), Num (span), Month (span)
      const sticker = $(section).find('.sticker__content');
      if (!sticker.length) return;

      const dateParts: string[] = [];
      sticker.contents().each((_, node) => {
        const text = $(node).text().trim();
        if (text) dateParts.push(text);
      });
      
      const dateText = dateParts.join(' ');
      if (!dateText) return;

      const currentYear = new Date().getFullYear();
      const isoDate = parseFrenchDate(`${dateText} ${currentYear}`);

      $(section).find('.list-table__content').each((j, item) => {
        const hour = $(item).find('.list-table__hour').text().trim();
        const type = $(item).find('.list-table__type').text().trim();
        const title = $(item).find('.m-b-n').text().trim();

        // Capture links if any
        const links: string[] = [];
        $(item).next('.list-table__links').find('a').each((_, a) => {
          const linkText = $(a).text().trim();
          const href = $(a).attr('href');
          if (href) links.push(`[${linkText}](${href.startsWith('http') ? href : 'https://www.elysee.fr' + href})`);
        });

        if (title) {
          const externalId = `elysee-${isoDate}-${hour}-${title.slice(0, 20)}`;
          events.push({
            id: generateDeterministicUUID(externalId),
            date: isoDate,
            title: title,
            description: `${hour} - ${type}${links.length ? '\n\n' + links.join('\n') : ''}`,
            institution: 'Élysée',
            category: type || 'Agenda Présidentiel',
            source_url: ELYSEE_AGENDA_URL
          });
        }
      });
    });

    console.log(`> Found ${events.length} items for Élysée agenda.`);

    let updatedCount = 0;
    for (const event of events) {
      const { error } = await supabase
        .from('events')
        .upsert(event, { onConflict: 'id' });
      if (!error) updatedCount++;
      else console.error(`Error for ${event.id}:`, error.message);
    }

    console.log(`\nTERMINE : ${updatedCount} événements de l'Élysée synchronisés.`);

  } catch (error) {
    console.error('Error syncing Élysée agenda:', error);
  }
}

main().catch(console.error);
