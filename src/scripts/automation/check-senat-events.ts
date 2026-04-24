import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('institution', 'Sénat')
    .limit(5);

  if (error) {
    console.error(error);
    return;
  }

  data.forEach(e => {
    console.log(`--- EVENT ---`);
    console.log(`Title: ${e.title}`);
    console.log(`Description: ${e.description.slice(0, 100)}...`);
  });
}

main();
