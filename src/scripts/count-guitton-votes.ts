
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function countVotes() {
  console.log('🔍 Counting votes for Jordan Guitton...');
  const { count, error } = await supabase
    .from('deputy_votes')
    .select('*', { count: 'exact', head: true })
    .eq('deputy_an_id', 'PA793218');

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  console.log('TOTAL VOTES:', count);
}

countVotes();
