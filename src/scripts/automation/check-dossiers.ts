import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('laws')
    .select('id, title, category, context, date_adopted, created_at')
    .ilike('context', 'dossier_premium%')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Error:', error);
  } else {
    console.log(`Total laws in DB: ${data?.length}`);
    console.log(JSON.stringify(data, null, 2));
  }
}

check();
