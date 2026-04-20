import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function init() {
  console.log('Initializing senators table...');
  
  // Attempting to create table via RPC if available - usually 'exec_sql' exists in many dev projects
  // If not, I will assume the table might be created manually or via some other means
  // But for this task, I'll try to use the public 'senat' data structure
  
  const { error } = await supabase.rpc('exec_sql', {
    sql_query: `
      CREATE TABLE IF NOT EXISTS senators (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        party TEXT,
        party_color TEXT,
        department TEXT,
        department_code TEXT,
        slug TEXT UNIQUE,
        photo_url TEXT,
        biography TEXT,
        legal_issues TEXT DEFAULT 'Aucune affaire connue',
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `
  });

  if (error) {
    console.error('Error creating table:', error);
    console.log('Falling back to checking if table exists via a select...');
    const { error: selectError } = await supabase.from('senators').select('*').limit(1);
    if (selectError) {
      console.error('Table senators does not exist and could not be created via RPC. Please ensure it exists.');
    } else {
      console.log('Table senators already exists.');
    }
  } else {
    console.log('Table senators created successfully.');
  }
}

init();
