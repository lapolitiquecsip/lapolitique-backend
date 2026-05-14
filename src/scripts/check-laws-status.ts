import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const { data, error } = await supabase
    .from('laws')
    .select('id, title, category, context')
    .ilike('context', 'dossier_premium%');
  
  if (error) {
    console.error(error);
    return;
  }
  
  console.log(`Found ${data.length} dossiers.`);
  data.forEach(d => {
    console.log(`- [${d.category}] ${d.title} (Context: ${d.context})`);
  });
}

check();
