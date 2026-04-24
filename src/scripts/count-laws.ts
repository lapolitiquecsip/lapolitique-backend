import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function count() {
  const { count, error } = await supabase
    .from('scrutins')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'LOI');
  
  const { data: samples } = await supabase
    .from('scrutins')
    .select('objet, pour, contre, abstention')
    .eq('type', 'LOI')
    .neq('pour', 0)
    .limit(3);

  console.log(`Total Laws (LOI): ${count}`);
  console.log(`Samples with counts:`, JSON.stringify(samples, null, 2));
}

count();
