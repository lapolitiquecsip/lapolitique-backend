
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
  const today = new Date().toLocaleDateString('en-CA');
  
  console.log(`Checking events for institution AN on ${today}...`);

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('institution', 'AN')
    .eq('date', today)
    .order('title', { ascending: true });

  if (error) {
    console.error('Error fetching events:', error);
    return;
  }

  console.log(`Found ${data.length} events for AN on ${today}:`);
  data.forEach(e => {
    console.log(`- ${e.title} (Short: ${e.short_title})`);
  });
}

check();
