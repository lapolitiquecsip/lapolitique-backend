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

async function main() {
  console.log('--- NETTOYAGE DES DONNEES SENSIBLES (PATRIMOINE & REVENUS) ---');

  const { data: deputies, error } = await supabase
    .from('deputies')
    .select('id, first_name, last_name, biography')
    .ilike('biography', '%INTEGRITY_START%');

  if (error) {
    console.error('Erreur SQL:', error.message);
    return;
  }

  console.log(`> ${deputies?.length} profiles avec blocs d'intégrité détectés.`);

  let updatedCount = 0;

  for (const dep of deputies || []) {
    const bio = dep.biography || '';
    
    const startMarker = '<!-- INTEGRITY_START -->';
    const endMarker = '<!-- INTEGRITY_END -->';
    
    if (!bio.includes(startMarker) || !bio.includes(endMarker)) continue;

    const parts = bio.split(startMarker);
    const before = parts[0];
    const rest = parts[1].split(endMarker);
    const integrityBlock = rest[0]; // This is <!-- { JSON } -->
    const after = rest[1] || '';

    // Extract JSON from comment markers
    const jsonStr = integrityBlock.replace('<!--', '').replace('-->', '').trim();
    
    try {
      const integrity = JSON.parse(jsonStr);
      
      // REMOVE SENSITIVE DATA
      delete integrity.income;
      delete integrity.patrimony;
      
      const newIntegrityJson = JSON.stringify(integrity);
      const updatedBio = before + startMarker + `\n<!-- ${newIntegrityJson} -->\n` + endMarker + after;

      const { error: updateError } = await supabase
        .from('deputies')
        .update({ biography: updatedBio })
        .eq('id', dep.id);

      if (!updateError) {
        updatedCount++;
      } else {
        console.error(`Erreur lors de la mise à jour de ${dep.last_name}:`, updateError.message);
      }
    } catch (e) {
      console.error(`Erreur de parsing JSON pour ${dep.last_name}`);
    }
  }

  console.log(`\nTERMINE : ${updatedCount} profiles nettoyés avec succès.`);
}

main().catch(console.error);
