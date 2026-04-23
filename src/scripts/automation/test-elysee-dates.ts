import * as cheerio from 'cheerio';
import { parseFrenchDate } from './utils.js';

const ELYSEE_AGENDA_URL = 'https://www.elysee.fr/agenda';

async function main() {
  const response = await fetch(ELYSEE_AGENDA_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });
  const html = await response.text();
  const $ = cheerio.load(html);

  $('section.container').each((i, section) => {
    const sticker = $(section).find('.sticker__content');
    if (!sticker.length) return;

    const dateParts: string[] = [];
    sticker.contents().each((_, node) => {
      const text = $(node).text().trim();
      if (text) dateParts.push(text);
    });
    
    const dateText = dateParts.join(' ');
    const currentYear = new Date().getFullYear();
    const finalStr = `${dateText} ${currentYear}`;
    const isoDate = parseFrenchDate(finalStr);

    const eventCount = $(section).find('.list-table__content').length;
    
    console.log(`Raw dateText: "${dateText}" -> Combined: "${finalStr}" -> Parsed: ${isoDate} (Events: ${eventCount})`);
  });
}

main();
