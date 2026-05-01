import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const { data, count, error } = await supabase
    .from('laws')
    .select('title, timeline, content', { count: 'exact' })
    .is('content', null);

  if (error) {
    console.error(error);
  } else {
    console.log(`Nombre de lois incomplètes : ${count}`);
    console.log("Premières lois trouvées :");
    data?.slice(0, 10).forEach(l => console.log(`- ${l.title} (Content: ${!!l.content}, Timeline: ${l.timeline})`));
  }
}

check();
