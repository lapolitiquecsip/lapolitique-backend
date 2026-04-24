import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspect() {
  const { data, error } = await supabase
    .from('scrutins')
    .select('group_results')
    .not('group_results', 'is', null)
    .limit(1);
  
  if (data && data[0]) {
    console.log(JSON.stringify(data[0].group_results, null, 2));
  }
}

inspect();
