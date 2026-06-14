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

async function clean() {
  console.log("=== Nettoyage des doublons ===");
  const { data: laws, error } = await supabase
    .from('laws')
    .select('id, context, created_at')
    .ilike('context', 'dossier_premium:%')
    .order('created_at', { ascending: true });

  if (error || !laws) {
    console.error('Error fetching laws:', error);
    return;
  }

  const seenContexts = new Set<string>();
  const idsToDelete: string[] = [];

  for (const law of laws) {
    if (seenContexts.has(law.context)) {
      idsToDelete.push(law.id);
    } else {
      seenContexts.add(law.context);
    }
  }

  console.log(`Trouvé ${laws.length} dossiers premium au total.`);
  console.log(`Trouvé ${idsToDelete.length} doublons à supprimer.`);

  if (idsToDelete.length > 0) {
    // Delete in chunks to avoid URL too long issues if there are many
    const chunkSize = 50;
    for (let i = 0; i < idsToDelete.length; i += chunkSize) {
      const chunk = idsToDelete.slice(i, i + chunkSize);
      const { error: delError } = await supabase
        .from('laws')
        .delete()
        .in('id', chunk);
      
      if (delError) {
        console.error('Error deleting chunk:', delError);
      } else {
        console.log(`Supprimé ${chunk.length} doublons...`);
      }
    }
  }

  console.log("=== Terminé ===");
}

clean();
