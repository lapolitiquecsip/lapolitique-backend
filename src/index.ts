import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
dotenv.config();
import { apiLimiter } from './middleware/rateLimit.js';
import { startWorkers } from './workers/index.js';
import { runAssembleePipeline } from './workers/assemblee-pipeline.js';
import { runSeed } from './scripts/seed.js';
import { serve } from 'inngest/express';
import { initMonitoring } from './lib/monitoring.js';
import {
  inngest,
  fetchVotesFn,
  scrutinSummarizerFn,
  fetchPetitionsFn,
  fetchLiveLawsFn
} from './lib/inngest.js';

// Load routes
import contentRoutes from './routes/content.js';
import vocabularyRoutes from './routes/vocabulary.js';
import deputiesRoutes from './routes/deputies.js';
import politiciansRoutes from './routes/politicians.js';
import lawsRoutes from './routes/laws.js';
import calendarRoutes from './routes/calendar.js';
import subscribersRoutes from './routes/subscribers.js';
import comparateurRoutes from './routes/comparateur.js';

initMonitoring();

const app = express();
const port = process.env.PORT || 3001;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

app.use(helmet());
app.use(cors({ origin: frontendUrl }));
app.use(express.json());
app.use(apiLimiter); // Apply rate limiter to all requests globally or adapt per-route

// Health route
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Inngest route
app.use('/api/inngest', serve({
  client: inngest,
  functions: [
    fetchVotesFn,
    scrutinSummarizerFn,
    fetchPetitionsFn,
    fetchLiveLawsFn
  ]
}));

// Resources routes
app.use('/api/content', contentRoutes);
app.use('/api/vocabulary', vocabularyRoutes);
app.use('/api/deputies', deputiesRoutes);
app.use('/api/politicians', politiciansRoutes);
app.use('/api/laws', lawsRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/subscribers', subscribersRoutes);
app.use('/api/comparateur', comparateurRoutes);

// Admin route to trigger pipeline manually
app.post('/api/admin/run-pipeline', async (req, res) => {
  const { name } = req.query;
  if (name === 'assemblee') {
    // Run async and return immediately (or wait, but better to await to send results back)
    try {
      const result = await runAssembleePipeline();
      res.json({ message: 'Pipeline executed', result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  } else {
    res.status(400).json({ error: 'Unknown pipeline' });
  }
});

app.get('/api/admin/pipeline-logs', async (req, res) => {
  try {
    const { supabase } = await import('./config/supabase.js');
    const { data, error } = await supabase
      .from('pipeline_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/seed', async (req, res) => {
  try {
    const result = await runSeed();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
  startWorkers(); // Re-enabled after indexing
});
