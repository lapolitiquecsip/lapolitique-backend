
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const { count, error } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .gte('date', today)
    .lte('date', tomorrow);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log(`Total events for ${today} to ${tomorrow}:`, count);
  }
  
  const { data: sample } = await supabase
    .from('events')
    .select('date, title, short_title')
    .gte('date', today)
    .lte('date', tomorrow)
    .limit(5);
  console.log('Sample events in range:', sample);
}

check();
