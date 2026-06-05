import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data } = await supabase.from('petitions').select('*').order('created_at', { ascending: false }).limit(5);
  console.log("Recent:", data);
  const { data: popular } = await supabase.from('petitions').select('*').order('signatures', { ascending: false }).limit(5);
  console.log("Popular:", popular);
}
main();
