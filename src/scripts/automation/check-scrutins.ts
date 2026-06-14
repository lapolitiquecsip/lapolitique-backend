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
  // Fetch the latest 20 scrutins of type LOI
  const { data: scrutins, error } = await supabase
    .from('scrutins')
    .select('id, numero, date_scrutin, objet, resultat, type')
    .eq('type', 'LOI')
    .order('date_scrutin', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching scrutins:', error);
    return;
  }

  console.log(`Latest 20 LOI scrutins in DB:`);
  for (const s of scrutins) {
    // Check if there is an existing law/dossier for this scrutin
    const { data: existingLaw } = await supabase
      .from('laws')
      .select('id, title, context')
      .eq('title', s.objet)
      .single();

    console.log(`- Date: ${s.date_scrutin}, Numero: ${s.numero}, Resultat: ${s.resultat}`);
    console.log(`  Objet: ${s.objet}`);
    console.log(`  Existing Law: ${existingLaw ? `Yes (ID: ${existingLaw.id}, Context: ${existingLaw.context})` : 'NO'}`);
  }
}

check();
