import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function count() {
  const { data, error } = await supabase
    .from('scrutins')
    .select('id, objet, pour, contre, abstention')
    .or('objet.ilike.%soutien%,objet.ilike.%restitution%,objet.ilike.%renforcement%');

  if (error) {
    console.error(error);
    return;
  }

  console.log(`Matching scrutins found: ${data?.length || 0}`);
  data?.forEach((item) => {
    console.log(`ID: ${item.id} | Objet: ${item.objet} | Pour: ${item.pour} | Contre: ${item.contre}`);
  });
}

count();
