
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  // 1. Fetch all adopted laws from scrutins
  const { data: scrutins, error: sErr } = await supabase
    .from('scrutins')
    .select('id, objet, date_scrutin, resultat')
    .eq('type', 'LOI')
    .ilike('resultat', '%adopté%')
    .order('date_scrutin', { ascending: false });

  if (sErr) {
    console.error(sErr);
    return;
  }

  // 2. Fetch all premium dossiers from laws
  const { data: laws, error: lErr } = await supabase
    .from('laws')
    .select('id, title, context');

  if (lErr) {
    console.error(lErr);
    return;
  }

  console.log(`Found ${scrutins.length} adopted laws in scrutins.`);
  console.log(`Found ${laws.length} laws in database.`);

  const missing = scrutins.filter(scrutin => {
    return !laws.some(law => law.title === scrutin.objet || (law.context && law.context.includes(scrutin.id)));
  });

  console.log(`Missing premium dossiers: ${missing.length}`);
  missing.forEach((item, i) => {
    console.log(`${i + 1}. [ID: ${item.id}] [Date: ${item.date_scrutin}] ${item.objet}`);
  });
}

test();
