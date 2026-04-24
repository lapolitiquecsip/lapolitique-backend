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

async function checkApril10() {
  const { data, error } = await supabase
    .from('events')
    .select('institution, title')
    .eq('date', '2026-04-10');

  if (error) {
    console.error(error);
    return;
  }

  console.log('Events on April 10:', data);
}

checkApril10();
