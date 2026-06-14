import { Inngest } from 'inngest';
import { fetchAndParseVotes } from '../scripts/automation/fetch-votes.js';
import { summarizeScrutins } from '../scripts/automation/scrutin-summarizer.js';
import { main as fetchPetitions } from '../scripts/automation/fetch-petitions.js';
import { syncLiveLaws } from '../scripts/automation/fetch-live-laws.js';

export const inngest = new Inngest({ id: 'lapolitique-backend' });

// 1. Fetch votes hourly
export const fetchVotesFn = inngest.createFunction(
  { 
    id: 'fetch-votes', 
    triggers: [
      { cron: '0 * * * *' },
      { event: 'cron/fetch-votes' }
    ],
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
    triggers: [
      { cron: '0 */6 * * *' },
      { event: 'cron/fetch-petitions' }
    ],
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
    triggers: [
      { cron: '0 */2 * * *' },
      { event: 'cron/fetch-live-laws' }
    ],
    retries: 3 
  },
  async () => {
    await syncLiveLaws();
    return { success: true };
  }
);
