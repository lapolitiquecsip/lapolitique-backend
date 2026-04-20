import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadAndUnzip } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const AGENDA_URL = 'https://data.assemblee-nationale.fr/static/openData/repository/17/vp/agenda/Agenda_json.zip';
const DATA_DIR = path.join(__dirname, '../../../data/agenda_an');

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

  let updatedCount = 0;

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const raw = fs.readFileSync(path.join(entriesDir, file), 'utf8');
    const data = JSON.parse(raw).reunion;

    const event = {
      external_id: data.uid,
      date: data.cycleDeVie.chrono.jourSeance || data.dateSeance || data.timestampDebut.split('T')[0],
      title: data.libelle || data.typeReunion,
      description: data.resume || data.typeReunion,
      institution: 'AN',
      category: data.organeReuniRef || 'Plénière',
      type: data.typeReunion,
      source_url: `https://www.assemblee-nationale.fr/dyn/17/agenda/${data.uid}`
    };

    const { error } = await supabase
      .from('events')
      .upsert(event, { onConflict: 'external_id' });

    if (!error) updatedCount++;
  }

  console.log(`\nTERMINE : ${updatedCount} événements d'agenda synchronisés.`);
}

main().catch(console.error);
