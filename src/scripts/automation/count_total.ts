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

async function countTotal() {
  const { count, error } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error(error);
    return;
  }

  console.log('Total events in DB:', count);
}

countTotal();
