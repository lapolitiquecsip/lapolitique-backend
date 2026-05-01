import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const { data, error } = await supabase
    .from('laws')
    .select('title, author')
    .ilike('title', '%2602%');

  if (error) {
    console.error(error);
  } else {
    console.log(`Résultats pour 2602 : ${data?.length}`);
    data?.forEach(l => console.log(`- ${l.title} (Auteur: ${l.author})`));
  }
}

check();
