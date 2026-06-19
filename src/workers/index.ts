import { runAssembleePipeline } from './assemblee-pipeline.js';
import { fetchAndParseVotes } from '../scripts/automation/fetch-votes.js';
import { generateDossiers } from '../scripts/automation/dossier-generator.js';
import { syncLawsAN } from '../scripts/automation/fetch-laws.js';
import { syncLiveLaws } from '../scripts/automation/fetch-live-laws.js';
import * as Sentry from '@sentry/node';

export function startWorkers() {
  console.log('[Workers] Starting interval workers...');
  
  // Run every 120 minutes to avoid database overload
  const intervalMs = 120 * 60 * 1000;

  const runAll = async () => {
    console.log('[Workers] Running all scheduled tasks...');
    const startTime = Date.now();
    
    const tasks = [
      { name: 'runAssembleePipeline', fn: runAssembleePipeline },
      { name: 'fetchAndParseVotes', fn: fetchAndParseVotes },
      { name: 'generateDossiers', fn: generateDossiers },
      { name: 'syncLawsAN', fn: syncLawsAN },
      { name: 'syncLiveLaws', fn: syncLiveLaws }
    ];

    for (const task of tasks) {
      try {
        console.log(`[Workers] Starting task: ${task.name}`);
        await task.fn();
        console.log(`[Workers] Task completed successfully: ${task.name}`);
      } catch (e: any) {
        console.error(`[Workers] Task execution failed for ${task.name}:`, e);
        Sentry.captureException(e, {
          tags: { component: 'worker-orchestrator', taskName: task.name }
        });
      }
    }

    const duration = (Date.now() - startTime) / 1000;
    console.log(`[Workers] All scheduled tasks runs completed in ${duration}s.`);
    // Schedule next run only after current one finished
    console.log(`[Workers] Scheduling next run in ${intervalMs / 1000 / 60} minutes.`);
    setTimeout(runAll, intervalMs);
  };

  // Start the cycle
  runAll();
}

