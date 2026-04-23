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
  
  // Clean all Elysee events from April 22, 23 and March 14, 21 that were wrongly parsed
  const { data, error } = await supabase
    .from('events')
    .delete()
    .in('institution', ['Élysée'])
    .in('date', ['2026-04-22', '2026-04-23', '2026-03-14', '2026-03-21']);
    
  if (error) {
    console.error('Error deleting:', error);
  } else {
    console.log('Successfully deleted bogus Elysee events.');
  }
}

main();
