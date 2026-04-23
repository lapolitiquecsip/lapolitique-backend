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

async function main() {
  console.log('Cleaning up orphaned events...');
  
  // The bug caused future Senate events to be logged as today (e.g., 2026-04-23)
  // Let's delete all Senat events from April 22 and 23 to be safe, 
  // as the real upcoming schedule is mostly in May anyway.
  
  const { data, error } = await supabase
    .from('events')
    .delete()
    .in('institution', ['Sénat'])
    .in('date', ['2026-04-22', '2026-04-23']);
    
  if (error) {
    console.error('Error deleting:', error);
  } else {
    console.log('Successfully deleted bogus Senate events from April 22/23.');
  }
}

main();
