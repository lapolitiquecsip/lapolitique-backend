import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkScrutins() {
  const { data: scrutins } = await supabase
    .from('scrutins')
    .select('id, objet, type, resultat, pour, contre')
    .in('id', ['VTANR5L17V6181', 'VTANR5L17V6318']);

  console.log(scrutins);
  
  const { data: premium } = await supabase
    .from('laws')
    .select('id, title, context')
    .ilike('title', '%RÉTENTION ADMINISTRATIVE%');
    
  console.log('Premium Dossiers:', premium);
}

checkScrutins();
