
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runMigration() {
  const sqlFile = path.join(process.cwd(), 'supabase/migrations/20260424_add_time_to_events.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');

  console.log('🚀 Running migration...');
  
  // Try using RPC if it exists, otherwise tell the user
  try {
    const { error } = await supabase.rpc('exec_sql', { query: sql });
    if (error) {
       console.error('❌ RPC Error (exec_sql might not exist):', error.message);
       console.log('\n--- PLEASE RUN THIS SQL MANUALLY IN SUPABASE DASHBOARD ---\n');
       console.log(sql);
       console.log('\n-----------------------------------------------------------\n');
    } else {
       console.log('✅ Migration successful via RPC.');
    }
  } catch (err) {
    console.error('❌ Failed to run migration:', err);
  }
}

runMigration();
