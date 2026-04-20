import { runAssembleePipeline } from './assemblee-pipeline';

export function startWorkers() {
  console.log('[Workers] Starting interval workers...');
  
  // Run every 30 minutes
  const intervalMs = 30 * 60 * 1000;

  // Run immediately on boot, then setup interval
  runAssembleePipeline().catch((e: any) => console.error('[Workers] Initial run failed', e));

  setInterval(() => {
    runAssembleePipeline().catch((e: any) => console.error('[Workers] Scheduled run failed', e));
  }, intervalMs);
}
