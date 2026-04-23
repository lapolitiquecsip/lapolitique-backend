import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
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

async function scrapeWithBrowser(url: string, source: typeof SOURCES[0]) {
  console.log(`  > Opening browser for: ${url}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    
    // Wait for the cards to load
    await page.waitForSelector('.card--initiative', { timeout: 30000 });
    
    // Scrape signatures and metadata
    const petitions = await page.evaluate((sourceBaseUrl) => {
      const results: any[] = [];
      const cards = document.querySelectorAll('.card--initiative');
      
      cards.forEach(card => {
        const titleEl = card.querySelector('.card__title');
        const title = titleEl?.textContent?.trim() || '';
        
        let relUrl = card.querySelector('a.card__link')?.getAttribute('href') || '';
        if (relUrl.includes('?')) relUrl = relUrl.split('?')[0];
        const fullUrl = relUrl.startsWith('http') ? relUrl : `${sourceBaseUrl}${relUrl}`;
        
        // Signatures
        const sigEl = card.querySelector('.progress__bar__number');
        const sigText = sigEl?.textContent?.trim() || '0';
        const signatures = parseInt(sigText.replace(/[^0-9]/g, '')) || 0;
        
        // Threshold
        const thresholdEl = card.querySelector('.progress__bar__total');
        const thresholdText = thresholdEl?.textContent?.trim() || '';
        let threshold = 100000;
        if (thresholdText) {
          threshold = parseInt(thresholdText.replace(/[^0-9]/g, '')) || threshold;
        }

        const category = card.querySelector('.tags--initiative a')?.textContent?.trim() || 'Pétition';

        if (title && fullUrl.includes('/initiatives/')) {
          results.push({ title, signatures, threshold, category, url: fullUrl });
        }
      });
      return results;
    }, source.baseUrl);

    return petitions;
  } catch (error) {
    console.error(`    ❌ Browser Error: ${(error as Error).message}`);
    return [];
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('--- SYNC PETITIONS WITH PLAYWRIGHT (Browser-based) ---');

  for (const source of SOURCES) {
    console.log(`\n> Site: ${source.name}`);
    for (const url of source.endpoints) {
      const petitions = await scrapeWithBrowser(url, source);
      
      for (const p of petitions) {
        const { error } = await supabase
          .from('petitions')
          .update({ 
            signatures: p.signatures, 
            threshold: p.threshold,
            category: p.category,
            updated_at: new Date().toISOString()
          })
          .eq('url', p.url);

        if (error) {
           // If update fails (e.g. doesn't exist), upsert a fresh one
           const { error: upsertError } = await supabase
            .from('petitions')
            .upsert({ ...p, institution: source.name }, { onConflict: 'url' });
           if (upsertError) console.error(`    ⚠️ DB Error:`, upsertError.message);
        }
        
        console.log(`    ✅ Updated "${p.title.substring(0, 30)}..." : ${p.signatures} sig`);
      }
    }
  }

  console.log('\nSUCCESS : Synchronisation par navigateur terminée.');
}

main().catch(console.error);
