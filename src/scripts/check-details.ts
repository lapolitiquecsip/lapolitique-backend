import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const { data, error } = await supabase
    .from('scrutins')
    .select('id, objet, status_detail, impact_detail, group_results')
    .eq('type', 'LOI')
    .limit(5);
  
  console.log(JSON.stringify(data, null, 2));
}

check();
