import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function find345() {
  const { data: scrutins, error } = await supabase
    .from('scrutins')
    .select('id, objet, pour')
    .eq('pour', 345);

  if (error) {
    console.error(error);
    return;
  }

  console.log('Scrutins with 345 POUR:', scrutins);
}

find345();
