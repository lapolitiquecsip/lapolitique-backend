import * as cheerio from 'cheerio';
import { parseFrenchDate } from './utils.js';

const SENAT_AGENDA_URL = 'https://www.senat.fr/ordre-du-jour/ordre-du-jour.html';

async function main() {
  const response = await fetch(SENAT_AGENDA_URL);
  const html = await response.text();
  const $ = cheerio.load(html);

  $('.accordion-item').each((i, dayEl) => {
    const dateRaw = $(dayEl).find('.accordion-header .accordion-button').text().trim();
    const isoDate = parseFrenchDate(dateRaw);
    console.log(`Raw: "${dateRaw}" -> Parsed: ${isoDate}`);
  });
}

main();
