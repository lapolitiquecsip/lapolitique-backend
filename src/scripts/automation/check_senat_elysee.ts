import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkSenatElysee() {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('date', '2026-04-22')
    .in('institution', ['Sénat', 'Élysée']);

  if (error) {
    console.error(error);
    return;
  }

  console.log(`Found ${data.length} events for Sénat/Élysée on 2026-04-22`);
  if (data.length > 0) {
    console.log('Institutions found:', [...new Set(data.map(e => e.institution))]);
    console.log('Sample Sénat event:', data.find(e => e.institution === 'Sénat'));
  }
}

checkSenatElysee();
