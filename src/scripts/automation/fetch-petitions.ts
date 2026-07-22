import { supabase } from '../../config/supabase.js';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import path from 'path';
import { logStart, logSuccess, logError } from '../../lib/monitoring.js';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

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
    
    const cards = $('.card--initiative');
    if (cards.length === 0) {
      throw new Error(`SELECTOR_NOT_FOUND: '.card--initiative' (no petition cards found on ${url})`);
    }
    
    cards.each((_, card) => {
      const cardEl = $(card);
      
      const titleEl = cardEl.find('.card__title');
      if (titleEl.length === 0) {
        console.warn(`[WARNING] SELECTOR_NOT_FOUND: '.card__title' in card item on ${url}`);
      }
      const title = titleEl.text().trim() || '';
      
      const linkEl = cardEl.find('a.card__link');
      if (linkEl.length === 0) {
        console.warn(`[WARNING] SELECTOR_NOT_FOUND: 'a.card__link' in card item on ${url}`);
      }
      let relUrl = linkEl.attr('href') || '';
      if (relUrl.includes('?')) relUrl = relUrl.split('?')[0];
      const fullUrl = relUrl.startsWith('http') ? relUrl : `${source.baseUrl}${relUrl}`;
      
      // Signatures
      const sigEl = cardEl.find('.progress__bar__number');
      if (sigEl.length === 0) {
        console.warn(`[WARNING] SELECTOR_NOT_FOUND: '.progress__bar__number' in card item on ${url}`);
      }
      const sigText = sigEl.text().trim() || '0';
      const signatures = parseInt(sigText.replace(/[^0-9]/g, '')) || 0;
      
      // Threshold
      const thresholdEl = cardEl.find('.progress__bar__total');
      if (thresholdEl.length === 0) {
        console.warn(`[WARNING] SELECTOR_NOT_FOUND: '.progress__bar__total' in card item on ${url}`);
      }
      const thresholdText = thresholdEl.text().trim() || '';
      let threshold = 100000;
      if (thresholdText) {
        threshold = parseInt(thresholdText.replace(/[^0-9]/g, '')) || threshold;
      }

      const category = cardEl.find('.tags--initiative a').text().trim() || 'Pétition';

      // Description
      const descEl = cardEl.find('.card__text--paragraph span:not(.card__text--status)');
      const description = descEl.text().trim() || '';

      // Statut affiché sur la carte (ex. « Enregistrée ») — état de base.
      const cardStatus = cardEl.find('.card__text--status').first().text().trim() || '';

      if (title && fullUrl.includes('/initiatives/')) {
        results.push({ title, description, signatures, threshold, category, url: fullUrl, cardStatus });
      }
    });

    return results;
  } catch (error: any) {
    console.error(`    ❌ Cheerio Error: ${error.message}`);
    throw error; // Re-throw so main() can log failure to monitoring
  }
}

// Le statut de cycle de vie « avancé » (transmise/examinée/classée) n'apparaît que sur la
// page de détail, dans l'élément .initiative-status. Absent → la pétition en est au stade de
// recueil, on retombe sur le statut de la carte (« Enregistrée »).
async function fetchDetailStatus(url: string, cardStatus: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return cardStatus;
    const $ = cheerio.load(await res.text());
    const adv = $('.initiative-status').first().text().replace(/\s+/g, ' ').trim();
    return adv || cardStatus;
  } catch {
    return cardStatus;
  }
}

export async function main() {
  const hcId = process.env.HEALTHCHECK_ID_PETITIONS;
  await logStart('fetchPetitions', hcId);

  let processedCount = 0;

  try {
    for (const source of SOURCES) {
      console.log(`\n> Site: ${source.name}`);
      for (const url of source.endpoints) {
        const petitions = await scrapeWithCheerio(url, source);
        console.log(`    Found ${petitions.length} petitions.`);
        
        for (const p of petitions) {
          // cardStatus ne doit pas partir tel quel en base (colonne inexistante) :
          // on le retire du spread et on résout le vrai statut via la page de détail.
          const { cardStatus, ...petitionRow } = p as any;
          const status = await fetchDetailStatus(p.url, cardStatus);
          const { error } = await supabase
            .from('petitions')
            .upsert({
              ...petitionRow,
              status,
              status_checked_at: new Date().toISOString(),
              institution: source.name,
              updated_at: new Date().toISOString()
            }, { onConflict: 'url' });

          if (error) {
             console.error(`    ⚠️ DB Error:`, error.message);
          } else {
             console.log(`    ✅ Upserted "${p.title.substring(0, 30)}..." : ${p.signatures} sig`);
             processedCount++;
          }
        }
      }
    }

    console.log('\nSUCCESS : Synchronisation par Cheerio terminée.');
    await logSuccess('fetchPetitions', processedCount, hcId);
    return processedCount;

  } catch (err: any) {
    await logError('fetchPetitions', err, hcId);
    throw err;
  }
}

// Standalone execution support
import { fileURLToPath } from 'url';
import fs from 'fs';
const nodePath = fs.realpathSync(process.argv[1]);
const currentPath = fileURLToPath(import.meta.url);
if (nodePath === currentPath || nodePath.endsWith('fetch-petitions.ts') || nodePath.endsWith('fetch-petitions.js')) {
  main().catch(console.error);
}
