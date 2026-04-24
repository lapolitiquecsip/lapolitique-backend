
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkRecentDeputies() {
  console.log('🔍 Checking deputies who voted on April 16, 2026...');
  
  // Find a scrutin from that date
  const { data: sData } = await supabase
    .from('scrutins')
    .select('id')
    .eq('date_scrutin', '2026-04-16T00:00:00+00:00')
    .limit(1);

  if (!sData || sData.length === 0) {
    console.log('No scrutin found for that date.');
    return;
  }

  const scrutinId = sData[0].id;
  console.log(`Scrutin ID: ${scrutinId}`);

  const { data: vData, error } = await supabase
    .from('deputy_votes')
    .select('deputy_an_id')
    .eq('scrutin_id', scrutinId)
    .limit(50);

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  console.log('DEPUTIES WHO VOTED:');
  console.log(vData.map(v => v.deputy_an_id).join(', '));
  
  const isGuittonThere = vData.some(v => v.deputy_an_id === 'PA793218');
  console.log(`Is Jordan Guitton (PA793218) in this set? ${isGuittonThere}`);
}

checkRecentDeputies();
