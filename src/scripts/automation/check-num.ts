import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const num = process.argv[2];
  if (!num) return;

  const { data, error } = await supabase
    .from('laws')
    .select('title, author')
    .ilike('title', `%${num}%`);

  if (error) {
    console.error(error);
  } else {
    console.log(`Résultats pour ${num} : ${data?.length}`);
    data?.forEach(l => console.log(`- ${l.title} (Auteur: ${l.author})`));
  }
}

check();
