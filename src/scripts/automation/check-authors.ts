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
    .select('author')
    .limit(50);

  if (error) {
    console.error(error);
  } else {
    const authors = [...new Set(data?.map(l => l.author))];
    console.log("Auteurs trouvés en base :");
    authors.forEach(a => console.log(`- ${a}`));
  }
}

check();
