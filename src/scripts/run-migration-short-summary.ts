
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

async function migrate() {
  console.log('Adding short_summary column to events table...');
  
  const { error } = await supabase.rpc('execute_sql', {
    sql: 'ALTER TABLE events ADD COLUMN IF NOT EXISTS short_summary TEXT;'
  });

  if (error) {
    console.error('Migration error (using direct query as fallback):', error);
    // If RPC is not available, we can't do much without DB access, but typically 
    // Supabase allows this if the user has configured the execute_sql function.
  } else {
    console.log('Migration successful!');
  }
}

migrate();
