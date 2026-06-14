import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyLaw() {
  // Find the law by title
  const { data: laws, error: lawsError } = await supabase
    .from('laws')
    .select('*')
    .ilike('title', '%RÉTENTION ADMINISTRATIVE%');

  if (lawsError) {
    console.error('Error fetching law:', lawsError);
    return;
  }

  if (!laws || laws.length === 0) {
    console.log('No law found with that title.');
    return;
  }

  const law = laws[0];
  console.log('Found Law:', law.title);
  console.log('Context:', law.context);

  if (law.context && law.context.startsWith('dossier_premium:')) {
    const scrutinId = law.context.split(':')[1];
    
    const { data: scrutin, error: scrutinError } = await supabase
      .from('scrutins')
      .select('*')
      .eq('id', scrutinId)
      .single();

    if (scrutinError) {
      console.error('Error fetching scrutin:', scrutinError);
      return;
    }

    console.log('\n--- SCRUTIN DATA ---');
    console.log('Scrutin ID:', scrutin.id);
    console.log('Objet:', scrutin.objet);
    console.log('POUR:', scrutin.pour);
    console.log('CONTRE:', scrutin.contre);
    console.log('ABSTENTION:', scrutin.abstention);
    
    // Check if the pour matches what's visible in the screenshot (345 POUR)
    if (scrutin.pour === 345) {
      console.log('\n✅ VERIFICATION SUCCESS: Scrutin "pour" count exactly matches the 345 shown in the screenshot!');
    } else {
      console.log(`\n❌ VERIFICATION FAILED: Scrutin "pour" is ${scrutin.pour}, but screenshot shows 345.`);
    }
  } else {
    console.log('Law does not have a premium dossier context.');
  }
}

verifyLaw();
