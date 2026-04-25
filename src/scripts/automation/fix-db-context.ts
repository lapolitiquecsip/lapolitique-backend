import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fixContexts() {
  console.log('--- FIXING LAWS CONTEXTS FOR SORTING ---');

  const { data: laws, error } = await supabase
    .from('laws')
    .select('id, context, title');

  if (error) {
    console.error('Error fetching laws:', error);
    return;
  }

  console.log(`> Processing ${laws.length} laws...`);

  let fixedCount = 0;
  for (const law of laws) {
    // If context starts with "Procédure :" or doesn't have [YYYY-MM-DD]
    if (law.context && (law.context.startsWith('Procédure :') || !law.context.startsWith('['))) {
      const newContext = `[1900-01-01] ${law.context}`;
      await supabase
        .from('laws')
        .update({ context: newContext })
        .eq('id', law.id);
      fixedCount++;
    }
  }

  console.log(`\nTERMINE : ${fixedCount} contextes mis à jour.`);
}

fixContexts().catch(console.error);
