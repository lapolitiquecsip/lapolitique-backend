import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const SOURCES = [
  {
    name: 'AN',
    baseUrl: 'https://petitions.assemblee-nationale.fr',
    endpoints: [
      'https://petitions.assemblee-nationale.fr/initiatives?order=most_voted',
      'https://petitions.assemblee-nationale.fr/initiatives?order=recent'
    ]
  }
];

async function scrapeWithCheerio(url: string, source: typeof SOURCES[0]) {
  console.log(`  > Fetching page with cheerio: ${url}`);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: any[] = [];
    
    $('.card--initiative').each((_, card) => {
      const cardEl = $(card);
      
      const titleEl = cardEl.find('.card__title');
      const title = titleEl.text().trim() || '';
      
      let relUrl = cardEl.find('a.card__link').attr('href') || '';
      if (relUrl.includes('?')) relUrl = relUrl.split('?')[0];
      const fullUrl = relUrl.startsWith('http') ? relUrl : `${source.baseUrl}${relUrl}`;
      
      // Signatures
      const sigEl = cardEl.find('.progress__bar__number');
      const sigText = sigEl.text().trim() || '0';
      const signatures = parseInt(sigText.replace(/[^0-9]/g, '')) || 0;
      
      // Threshold
      const thresholdEl = cardEl.find('.progress__bar__total');
      const thresholdText = thresholdEl.text().trim() || '';
      let threshold = 100000;
      if (thresholdText) {
        threshold = parseInt(thresholdText.replace(/[^0-9]/g, '')) || threshold;
      }

      const category = cardEl.find('.tags--initiative a').text().trim() || 'Pétition';

      // Description
      const descEl = cardEl.find('.card__text--paragraph span:not(.card__text--status)');
      const description = descEl.text().trim() || '';

      if (title && fullUrl.includes('/initiatives/')) {
        results.push({ title, description, signatures, threshold, category, url: fullUrl });
      }
    });

    return results;
  } catch (error: any) {
    console.error(`    ❌ Cheerio Error: ${error.message}`);
    return [];
  }
}

async function main() {
  console.log('--- SYNC PETITIONS WITH CHEERIO (HTTP-based) ---');

  for (const source of SOURCES) {
    console.log(`\n> Site: ${source.name}`);
    for (const url of source.endpoints) {
      const petitions = await scrapeWithCheerio(url, source);
      console.log(`    Found ${petitions.length} petitions.`);
      
      for (const p of petitions) {
        const { error } = await supabase
          .from('petitions')
          .upsert({ 
            ...p, 
            institution: source.name,
            updated_at: new Date().toISOString()
          }, { onConflict: 'url' });

        if (error) {
           console.error(`    ⚠️ DB Error:`, error.message);
        } else {
           console.log(`    ✅ Upserted "${p.title.substring(0, 30)}..." : ${p.signatures} sig`);
        }
      }
    }
  }

  console.log('\nSUCCESS : Synchronisation par Cheerio terminée.');
}

main().catch(console.error);
