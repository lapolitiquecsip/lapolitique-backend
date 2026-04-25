
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase
    .from('laws')
    .select('id, title, context')
    .order('context', { ascending: false })
    .limit(5);

  if (error) {
    console.error(error);
    return;
  }

  console.log('Top 5 laws by context DESC:');
  data.forEach((law, i) => {
    console.log(`${i + 1}. [${law.context}] ${law.title}`);
  });
}

test();
