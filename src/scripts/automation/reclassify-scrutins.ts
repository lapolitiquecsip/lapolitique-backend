
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function reclassify() {
  console.log('--- START RECLASSIFICATION ---');
  const { data: scrutins, error } = await supabase
    .from('scrutins')
    .select('id, objet, type');

  if (error) {
    console.error(error);
    return;
  }

  console.log(`Processing ${scrutins.length} scrutins...`);
  let updated = 0;

  for (const s of scrutins) {
    const titre = s.objet.toLowerCase();
    let newType = s.type;

    if (titre.includes("amendement")) {
      newType = "AMENDEMENT";
    } else if (titre.startsWith("l'ensemble du") || titre.startsWith("l'ensemble de la")) {
      newType = "LOI";
    } else if (titre.startsWith("l'article")) {
      newType = "ARTICLE";
    } else if (titre.includes("projet de loi") || titre.includes("proposition de loi")) {
      newType = "LOI";
    }

    if (newType !== s.type) {
      const { error: uError } = await supabase
        .from('scrutins')
        .update({ type: newType })
        .eq('id', s.id);
      
      if (!uError) updated++;
    }
  }

  console.log(`Reclassification done. Updated ${updated} records.`);
}

reclassify();
