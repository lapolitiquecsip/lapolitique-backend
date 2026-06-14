import { runAssembleePipeline } from './assemblee-pipeline.js';
import { fetchAndParseVotes } from '../scripts/automation/fetch-votes.js';
import { generateDossiers } from '../scripts/automation/dossier-generator.js';
import { syncLawsAN } from '../scripts/automation/fetch-laws.js';
import { syncLiveLaws } from '../scripts/automation/fetch-live-laws.js';

export function startWorkers() {
  console.log('[Workers] Starting interval workers...');
  
  // Run every 120 minutes to avoid database overload
  const intervalMs = 120 * 60 * 1000;

  const runAll = async () => {
    console.log('[Workers] Running all scheduled tasks...');
    const startTime = Date.now();
    try {
      await runAssembleePipeline();
      await fetchAndParseVotes();
      await generateDossiers();
      await syncLawsAN();
      await syncLiveLaws();
      const duration = (Date.now() - startTime) / 1000;
      console.log(`[Workers] All tasks completed successfully in ${duration}s.`);
    } catch (e: any) {
      console.error('[Workers] Task execution failed', e);
    } finally {
      // Schedule next run only after current one finished
      console.log(`[Workers] Scheduling next run in ${intervalMs / 1000 / 60} minutes.`);
      setTimeout(runAll, intervalMs);
    }
  };

  // Start the cycle
  runAll();
}

