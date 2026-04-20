
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
  const { data, error } = await supabase
    .from('deputies')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error fetching deputies:', error);
    return;
  }

  if (data && data.length > 0) {
    console.log('ALL COLUMNS:', Object.keys(data[0]).join(', '));
    console.log('SAMPLE DATA:', JSON.stringify(data[0], null, 2));
  } else {
    console.log('Deputies table is empty.');
  }
}

checkSchema();
