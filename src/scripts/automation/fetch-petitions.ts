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

// Un problème PASSAGER de la source (réseau, timeout, 5xx, 429, blocage 4xx) est marqué
// `transient` → ne doit PAS déclencher d'alerte DOWN. Un HTML qui a changé (page servie mais
// plus de cartes) est marqué `structural` → NOTRE scraper est cassé, on VEUT l'alerte.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
};

async function fetchHtml(url: string, attempts = 3): Promise<string> {
  let lastErr: any;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { transient: true, status: res.status });
      return await res.text();
    } catch (e: any) {
      lastErr = Object.assign(e, { transient: true });   // réseau/timeout/HTTP non-OK = passager
      if (i < attempts) { console.warn(`    … tentative ${i}/${attempts} échouée (${e.message}), retry`); await new Promise(r => setTimeout(r, 1500 * i)); }
    }
  }
  throw lastErr;
}

async function scrapeWithCheerio(url: string, source: typeof SOURCES[0]) {
  console.log(`  > Fetching page with cheerio: ${url}`);
  const html = await fetchHtml(url);   // lève une erreur `transient` après retries si la source est KO
  try {
    const $ = cheerio.load(html);
    const results: any[] = [];

    const cards = $('.card--initiative');
    if (cards.length === 0) {
      // Page servie mais plus aucune carte → la structure HTML a changé : NOTRE scraper est cassé.
      throw Object.assign(new Error(`SELECTOR_NOT_FOUND: '.card--initiative' introuvable sur ${url}`), { structural: true });
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

// NB : on N'extrait PAS le statut « avancé » de la page de détail. Cette page mélange le
// statut de la pétition avec celui de textes liés (ex. une PPL « examinée puis classée »),
// et rien ne les distingue de façon fiable — on risquerait d'attribuer à la pétition le
// statut d'un élément voisin. On se contente du statut PROPRE de la carte (« Enregistrée »,
// « Clôturée »…) ; le front déduit le reste des seuils réglementaires (100 000 signatures).

export async function main() {
  const hcId = process.env.HEALTHCHECK_ID_PETITIONS;
  await logStart('fetchPetitions', hcId);

  let processedCount = 0;
  let structuralErrors = 0;   // NOTRE scraper est cassé (HTML changé) → vraie alerte
  let transientErrors = 0;    // source injoignable/passagère → toléré, pas d'alerte

  try {
    for (const source of SOURCES) {
      console.log(`\n> Site: ${source.name}`);
      for (const url of source.endpoints) {
        let petitions: any[];
        try {
          petitions = await scrapeWithCheerio(url, source);
        } catch (e: any) {
          if (e.structural) { structuralErrors++; console.error(`    ❌ STRUCTUREL (${url}): ${e.message}`); }
          else { transientErrors++; console.warn(`    ⚠️ source injoignable (${url}, passager) : ${e.message}`); }
          continue;   // on n'interrompt pas le job pour une source
        }
        console.log(`    Found ${petitions.length} petitions.`);

        for (const p of petitions) {
          // cardStatus = état PROPRE de la pétition sur la plateforme (« Enregistrée »…).
          const { cardStatus, ...petitionRow } = p as any;
          const { error } = await supabase
            .from('petitions')
            .upsert({
              ...petitionRow,
              status: cardStatus || null,
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

    // DOWN (alerte) UNIQUEMENT si notre scraper est cassé (HTML changé) et qu'on n'a rien pu
    // récupérer. Une panne passagère de la source (transient) ne déclenche PAS de fausse alerte.
    if (structuralErrors > 0 && processedCount === 0) {
      // Le catch ci-dessous logguera l'échec (alerte) et fera échouer l'action.
      throw new Error(`Scraper pétitions cassé : ${structuralErrors} page(s) sans cartes (structure HTML changée ?).`);
    }
    if (transientErrors > 0 && processedCount === 0) {
      console.warn(`\n⚠️ Source pétitions momentanément injoignable (${transientErrors} échec(s) passager(s)). Données conservées, pas d'alerte.`);
    }
    console.log(`\nSUCCESS : ${processedCount} pétition(s) synchronisée(s)${structuralErrors ? ` — ⚠️ ${structuralErrors} page(s) structurellement KO` : ""}.`);
    await logSuccess('fetchPetitions', processedCount, hcId);
    return processedCount;

  } catch (err: any) {
    // Erreur inattendue (code/DB) → vraie alerte.
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
