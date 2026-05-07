import { runAssembleePipeline } from './assemblee-pipeline.js';
import { fetchAndParseVotes } from '../scripts/automation/fetch-votes.js';

export function startWorkers() {
  console.log('[Workers] Starting interval workers...');
  
  // Run every 30 minutes
  const intervalMs = 30 * 60 * 1000;

  const runAll = async () => {
    console.log('[Workers] Running all scheduled tasks...');
    try {
      await runAssembleePipeline();
      await fetchAndParseVotes();
      console.log('[Workers] All tasks completed successfully.');
    } catch (e: any) {
      console.error('[Workers] Task execution failed', e);
    }
  };

  // Run immediately on boot, then setup interval
  runAll();

  setInterval(runAll, intervalMs);
}

