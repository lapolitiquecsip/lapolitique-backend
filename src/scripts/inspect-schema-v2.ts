
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectSchema() {
  const { data: sData } = await supabase.from('scrutins').select('*').limit(1);
  const { data: lData } = await supabase.from('laws').select('*').limit(1);

  console.log('--- SCRUTINS COLUMNS ---');
  if (sData && sData[0]) console.log(Object.keys(sData[0]));
  
  console.log('\n--- LAWS COLUMNS ---');
  if (lData && lData[0]) console.log(Object.keys(lData[0]));
}

inspectSchema();
