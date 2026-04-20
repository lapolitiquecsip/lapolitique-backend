import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function clear() {
  console.log('🧹 Nettoyage de la table deputies...');
  const { error } = await supabase.from('deputies').delete().neq('last_name', 'VALUE_THAT_DOES_NOT_EXIST');
  if (error) {
    console.error('❌ Erreur lors du nettoyage :', error.message);
  } else {
    console.log('✅ Table vidée avec succès.');
  }
}

clear();
