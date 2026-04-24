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
  const sqlFile = path.join(process.cwd(), 'supabase/migrations/20260423_add_counts_to_scrutins.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');

  console.log('🚀 Running migration...');
  
  try {
    const { error } = await supabase.rpc('exec_sql', { query: sql });
    if (error) {
       console.error('❌ Migration Error:', error.message);
    } else {
       console.log('✅ Migration successful.');
    }
  } catch (err) {
    console.error('❌ Failed to run migration:', err);
  }
}

runMigration();
