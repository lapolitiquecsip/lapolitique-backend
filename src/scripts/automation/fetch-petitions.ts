import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERREUR : SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquante dans le .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const SOURCES = [
  {
    name: 'AN',
    url: 'https://petitions.assemblee-nationale.fr/initiatives?order=most_voted',
    baseUrl: 'https://petitions.assemblee-nationale.fr'
  },
  {
    name: 'Sénat',
    url: 'https://petitions.senat.fr/initiatives?order=most_voted',
    baseUrl: 'https://petitions.senat.fr'
  }
];

async function scrapeSource(source: typeof SOURCES[0]) {
  console.log(`> Scraping ${source.name} Petitions...`);
  
  try {
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    if (!response.ok) {
      console.error(`  - HTTP error ${response.status} for ${source.name}`);
      const text = await response.text();
      console.log(`  - Response snippet: ${text.substring(0, 200)}`);
      return [];
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const petitions: any[] = [];

    $('.card--initiative, .card.card--initiative').each((i, el) => {
      const titleEl = $(el).find('.card__title');
      const title = titleEl.text().trim();
      const relativeUrl = titleEl.find('a').attr('href') || $(el).attr('href') || '';
      const fullUrl = relativeUrl.startsWith('http') ? relativeUrl : `${source.baseUrl}${relativeUrl}`;
      
      const signaturesRaw = $(el).find('.card__support__count').text().trim();
      // Extract number
      const signatures = parseInt(signaturesRaw.replace(/\s/g, '').split('/')[0].replace(/[^0-9]/g, '')) || 0;
      
      const description = $(el).find('.card__text, .card__content').first().text().trim().substring(0, 300);
      
      const category = $(el).find('.card__label, .label').first().text().trim() || 'Général';

      if (title && fullUrl) {
        petitions.push({
          title,
          description,
          signatures,
          threshold: signatures > 100000 ? 500000 : 100000,
          institution: source.name,
          category,
          url: fullUrl
        });
      }
    });

    console.log(`  - Found ${petitions.length} petitions for ${source.name}`);
    return petitions;

  } catch (error) {
    console.error(`  - Error scraping ${source.name}:`, (error as Error).message);
    return [];
  }
}

async function main() {
  console.log('--- SYNC PETITIONS PORTALS ---');

  for (const source of SOURCES) {
    const petitions = await scrapeSource(source);
    
    if (petitions.length === 0) continue;

    for (const p of petitions) {
      const { error } = await supabase
        .from('petitions')
        .upsert(p, { onConflict: 'url' });

      if (error) {
        console.error(`  - Failed to upsert "${p.title}":`, error.message);
      }
    }
  }

  console.log('\nTERMINE : Synchronisation des pétitions effectuée.');
}

main().catch(console.error);
