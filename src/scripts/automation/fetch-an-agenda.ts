import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { downloadAndUnzip } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const AGENDA_URL = 'https://data.assemblee-nationale.fr/static/openData/repository/17/vp/reunions/Agenda.json.zip';
const DATA_DIR = path.join(__dirname, '../../../data/agenda_an');

function generateDeterministicUUID(input: string): string {
  const hash = crypto.createHash('sha1').update(input).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function main() {
  console.log('--- SYNC ASSEMBLEE NATIONALE AGENDA ---');

  await downloadAndUnzip(AGENDA_URL, DATA_DIR);

  const entriesDir = path.join(DATA_DIR, 'json/reunion');
  if (!fs.existsSync(entriesDir)) {
    console.error('Error: json/reunion directory not found in zip.');
    return;
  }

  const files = fs.readdirSync(entriesDir);
  console.log(`> Processing ${files.length} agenda items...`);

  const events: any[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    try {
      const raw = fs.readFileSync(path.join(entriesDir, file), 'utf8');
      const reunion = JSON.parse(raw).reunion;

      const externalId = reunion.uid;
      const eventId = generateDeterministicUUID(`an-${externalId}`);

      // Handle the case where some fields might be missing
      const dateRaw = reunion.timeStampDebut || reunion.timestampDebut;
      if (!dateRaw) continue;

      const date = dateRaw.split('T')[0];
      const timeMatch = dateRaw.match(/T(\d{2}:\d{2})/);
      const time = timeMatch ? timeMatch[1] : '';
      
      const rawTitle = reunion.ODJ?.convocationODJ?.item || reunion.libelle || reunion.typeReunion || 'Réunion';
      const title = time ? `[${time}] ${rawTitle}` : rawTitle;
      
      const description = reunion.ODJ?.resumeODJ?.item || rawTitle;

      events.push({
        id: eventId,
        date: date,
        title: title.length > 255 ? title.slice(0, 252) + '...' : title,
        description: description,
        institution: 'AN',
        category: reunion.organeReuniRef || 'Réunion',
        source_url: `https://www.assemblee-nationale.fr/dyn/17/agenda/${externalId}`
      });
    } catch (e) {
      console.error(`Error parsing file ${file}:`, e);
    }
  }

  console.log(`> Upserting ${events.length} events...`);

  // Batch upsert (Supabase handles up to ~1000 items well in one request)
  const BATCH_SIZE = 500;
  let successCount = 0;

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('events')
      .upsert(batch, { onConflict: 'id' });

    if (error) {
      console.error(`Error in batch ${i / BATCH_SIZE}:`, error.message);
    } else {
      successCount += batch.length;
    }
  }

  console.log(`\nTERMINE : ${successCount} événements d'agenda de l'AN synchronisés.`);
}

main().catch(console.error);
