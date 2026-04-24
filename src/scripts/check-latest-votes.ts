
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);



async function checkLatestDates() {
  console.log('\n🔍 Deep analysis for JORDAN GUITTON (PA793218) WITH SORT...');
  const { data: vData, error: vError } = await supabase
    .from('deputy_votes')
    .select('date_scrutin, scrutins(id, date_scrutin, type)')
    .eq('deputy_an_id', 'PA793218')
    .order('date_scrutin', { ascending: false })
    .limit(20);

  if (vError) {
    console.error('Error:', vError.message);
    return;
  }

  console.log('LATEST VOTES FOUND:');
  vData.forEach((v: any) => {
    const s = v.scrutins;
    if (s) {
       console.log(`- ${s.date_scrutin} [${s.type}] ${s.id}`);
    }
  });
}

checkLatestDates();
