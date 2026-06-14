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
  const { data } = await supabase.from('laws').select('title, context, date_adopted').limit(10);
  console.log("SAMPLE LAWS:");
  console.log(data);
  
  const { data: premium } = await supabase.from('laws').select('title').ilike('context', 'dossier_premium%').limit(5);
  console.log("PREMIUM DOSSIERS:");
  console.log(premium);
  
  const { data: props } = await supabase.from('laws').select('title, created_at').order('created_at', { ascending: false }).limit(5);
  console.log("RECENT PROPOSALS:");
  console.log(props);
}

main();
