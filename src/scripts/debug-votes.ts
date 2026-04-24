
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function debug() {
  console.log('Checking database status...');
  
  const { count: depCount } = await supabase.from('deputies').select('*', { count: 'exact', head: true });
  const { count: voteCount } = await supabase.from('deputy_votes').select('*', { count: 'exact', head: true });
  const { count: scrutinCount } = await supabase.from('scrutins').select('*', { count: 'exact', head: true });

  console.log(`Deputies: ${depCount}`);
  console.log(`Scrutins: ${scrutinCount}`);
  console.log(`Deputy Votes: ${voteCount}`);

  if (depCount && depCount > 0) {
    const { data: sampleDep } = await supabase.from('deputies').select('name, an_id').limit(5);
    console.log('Sample Deputies (an_id):', sampleDep);
  }
}

debug();
