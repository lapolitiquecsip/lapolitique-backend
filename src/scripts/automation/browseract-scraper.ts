import { syncLiveLaws } from './fetch-live-laws.js';
import { logStart, logSuccess, logError } from '../../lib/monitoring.js';

export async function startScraping() {
  const hcId = process.env.HEALTHCHECK_ID_BROWSERACT;
  await logStart('browseractScraper', hcId);
  try {
    const insertedCount = await syncLiveLaws();
    await logSuccess('browseractScraper', insertedCount, hcId, `Delegated to syncLiveLaws. Inserted: ${insertedCount}`);
    return insertedCount;
  } catch (err: any) {
    await logError('browseractScraper', err, hcId);
    throw err;
  }
}

// Standalone execution support
import { fileURLToPath } from 'url';
import fs from 'fs';
const nodePath = fs.realpathSync(process.argv[1]);
const currentPath = fileURLToPath(import.meta.url);
if (nodePath === currentPath || nodePath.endsWith('browseract-scraper.ts') || nodePath.endsWith('browseract-scraper.js')) {
  startScraping().catch(console.error);
}
