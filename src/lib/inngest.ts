import { Inngest } from 'inngest';
import { fetchAndParseVotes } from '../scripts/automation/fetch-votes.js';
import { generateDossiers } from '../scripts/automation/dossier-generator.js';
import { summarizeScrutins } from '../scripts/automation/scrutin-summarizer.js';
import { main as fetchPetitions } from '../scripts/automation/fetch-petitions.js';
import { syncLiveLaws } from '../scripts/automation/fetch-live-laws.js';
import { main as fetchAnAgenda } from '../scripts/automation/fetch-an-agenda.js';
import { main as fetchSenatAgenda } from '../scripts/automation/fetch-senat-agenda.js';
import { main as fetchElyseeAgenda } from '../scripts/automation/fetch-elysee-agenda.js';
import { main as summarizeDailySenat } from '../scripts/automation/summarize-daily-senat.js';
import { generateWeeklyStats } from '../scripts/automation/generate-weekly-stats.js';

export const inngest = new Inngest({ id: 'lapolitique-backend' });

// Inngest is event-only. GitHub Actions is the sole production scheduler.
export const fetchVotesFn = inngest.createFunction(
  { 
    id: 'fetch-votes', 
    triggers: [{ event: 'cron/fetch-votes' }],
    retries: 3 
  },
  async ({ step }) => {
    const count = await step.run('fetch-votes-data', async () => {
      return await fetchAndParseVotes();
    });
    
    // Chain scrutin summarizer after votes fetch
    await step.sendEvent('trigger-scrutin-summarizer', {
      name: 'scrutins.fetched',
      data: { processedCount: count }
    });
    
    return { count };
  }
);

// 2. Summarize scrutins triggered by the event
export const scrutinSummarizerFn = inngest.createFunction(
  { 
    id: 'scrutin-summarizer', 
    triggers: [{ event: 'scrutins.fetched' }],
    retries: 3 
  },
  async () => {
    await summarizeScrutins();
    return { success: true };
  }
);

// 3. Fetch petitions every 6 hours
export const fetchPetitionsFn = inngest.createFunction(
  { 
    id: 'fetch-petitions', 
    triggers: [{ event: 'cron/fetch-petitions' }],
    retries: 3 
  },
  async () => {
    await fetchPetitions();
    return { success: true };
  }
);

// 4. Fetch live laws every 2 hours
export const fetchLiveLawsFn = inngest.createFunction(
  { 
    id: 'fetch-live-laws', 
    triggers: [{ event: 'cron/fetch-live-laws' }],
    retries: 3 
  },
  async () => {
    await syncLiveLaws();
    return { success: true };
  }
);

// 5. Daily Agenda Sync (AN + Sénat + Élysée + Sénat daily summary)
export const syncAgendaFn = inngest.createFunction(
  {
    id: 'sync-agenda',
    triggers: [{ event: 'cron/sync-agenda' }],
    retries: 3
  },
  async ({ step }) => {
    await step.run('fetch-an-agenda', async () => {
      await fetchAnAgenda();
    });
    await step.run('fetch-senat-agenda', async () => {
      await fetchSenatAgenda();
    });
    await step.run('fetch-elysee-agenda', async () => {
      await fetchElyseeAgenda();
    });
    await step.run('summarize-daily-senat', async () => {
      await summarizeDailySenat();
    });
    return { success: true };
  }
);

// 6. Weekly Stats Generator
export const generateWeeklyStatsFn = inngest.createFunction(
  {
    id: 'generate-weekly-stats',
    triggers: [{ event: 'cron/generate-weekly-stats' }],
    retries: 3
  },
  async () => {
    await generateWeeklyStats();
    return { success: true };
  }
);

// 7. Generate Premium Dossiers for Adopted Laws
export const generateDossiersFn = inngest.createFunction(
  {
    id: 'generate-dossiers',
    triggers: [
      { event: 'cron/generate-dossiers' },
      { event: 'scrutins.fetched' }
    ],
    retries: 3
  },
  async () => {
    await generateDossiers();
    return { success: true };
  }
);
