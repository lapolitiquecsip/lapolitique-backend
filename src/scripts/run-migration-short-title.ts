
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

async function main() {
  const sql = "ALTER TABLE events ADD COLUMN IF NOT EXISTS short_title TEXT;";
  console.log('Applying migration...');
  
  // Try using RPC if available
  const { error } = await supabase.rpc('exec_sql', { query: sql });
  
  if (error) {
    console.error('Migration failed via RPC:', error.message);
    console.log('\n--- PLEASE RUN THIS SQL MANUALLY IN SUPABASE DASHBOARD ---\n');
    console.log(sql);
    console.log('\n-----------------------------------------------------------\n');
  } else {
    console.log('✅ Migration successful!');
  }
}

main().catch(console.error);
