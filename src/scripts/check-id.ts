
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkId() {
  const { data } = await supabase
    .from('deputies')
    .select('*')
    .eq('an_id', 'PA793146');

  console.log('DEPUTY FOR PA793146:', JSON.stringify(data, null, 2));
}

checkId();
