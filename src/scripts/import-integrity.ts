import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * MOCK DATA GENERATOR for Transparency & Patrimony
 * We base the simulation on the deputy's profile and known public records
 */
async function main() {
  console.log('--- ENRICHISSEMENT TRANSPARENCE & PATRIMOINE (INTEGRITY PIPELINE) ---');

  const { data: deputies, error } = await supabase
    .from('deputies')
    .select('id, first_name, last_name, biography, party');

  if (error) {
    console.error('Erreur SQL:', error.message);
    return;
  }

  console.log(`> Traitement de ${deputies?.length} députés...`);

  let updatedCount = 0;

  for (const dep of deputies || []) {
    const bio = dep.biography || '';
    const bioLower = bio.toLowerCase();
    
    // 1. INTEGRITY DATA (ASSOCIATIONS)
    const associations = [];
    if (bio.includes('Amitiés internationales')) {
      const parts = bio.split('**Amitiés internationales** : ')[1];
      if (parts) associations.push(...parts.split(', ').map(s => `Grp d'amitié ${s}`));
    }

    const integrity_json = JSON.stringify({
      associations: associations.slice(0, 3)
    });

    // We store the JSON in the biography field as a hidden block at the end
    const updatedBio = bio.split('<!-- INTEGRITY_START -->')[0] + 
      `\n\n<!-- INTEGRITY_START -->\n<!-- ${integrity_json} -->\n<!-- INTEGRITY_END -->`;

    const { error: updateError } = await supabase
      .from('deputies')
      .update({ biography: updatedBio })
      .eq('id', dep.id);

    if (!updateError) {
      updatedCount++;
      if (updatedCount % 50 === 0) console.log(`> ${updatedCount} profils d'intégrité (associations uniquement) mis à jour...`);
    } else {
        console.error(`Erreur pour ${dep.first_name}:`, updateError.message);
    }
  }

  console.log(`\nTERMINE : ${updatedCount} profils d'intégrité nettoyés.`);
}

main().catch(console.error);
