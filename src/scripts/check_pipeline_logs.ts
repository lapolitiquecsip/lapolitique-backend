import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const { data, error } = await supabase
    .from('pipeline_logs')
    .select('*')
    .eq('status', 'error')
    .order('run_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error(error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}
main();
