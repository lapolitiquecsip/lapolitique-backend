
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

async function clear() {
  const today = new Date().toISOString().split('T')[0];
  console.log('Clearing short_title for events >=', today);
  
  const { count, error } = await supabase
    .from('events')
    .update({ short_title: null })
    .gte('date', today);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Cleared successfully.');
  }
}

clear();
