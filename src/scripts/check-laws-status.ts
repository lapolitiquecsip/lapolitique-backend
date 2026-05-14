
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function check() {
  console.log('--- SCRUTINS ---');
  const { data: scrutins, error: sError } = await supabase
    .from('scrutins')
    .select('id, objet, category, summary, why_it_matters')
    .order('date_scrutin', { ascending: false })
    .limit(5);
  
  if (sError) console.error(sError);
  else console.log(JSON.stringify(scrutins, null, 2));

  console.log('\n--- LAWS ---');
  const { data: laws, error: lError } = await supabase
    .from('laws')
    .select('id, title, category, summary')
    .order('created_at', { ascending: false })
    .limit(5);

  if (lError) console.error(lError);
  else console.log(JSON.stringify(laws, null, 2));
}

check();
