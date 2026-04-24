
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkGuitton() {
  console.log('🔍 Checking for Jordan Guitton in DB...');
  const { data, error } = await supabase
    .from('deputies')
    .select('*')
    .ilike('last_name', '%Guitton%');

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  console.log('GUITTON DATA:', JSON.stringify(data, null, 2));
}

checkGuitton();
