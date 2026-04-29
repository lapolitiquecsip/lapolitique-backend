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

  let hasMore = true;
  let offset = 0;
  let totalFixed = 0;

  while (hasMore) {
    const { data: laws, error } = await supabase
      .from('laws')
      .select('id, context, title')
      .range(offset, offset + 99);

    if (error) {
      console.error('Error fetching laws:', error);
      break;
    }

    if (!laws || laws.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`> Processing batch from ${offset}...`);

    for (const law of laws) {
      if (law.context && (law.context.startsWith('Procédure :') || !law.context.startsWith('['))) {
        const newContext = `[1900-01-01] ${law.context}`;
        await supabase
          .from('laws')
          .update({ context: newContext })
          .eq('id', law.id);
        totalFixed++;
      }
    }

    offset += 100;
  }

  console.log(`\nTERMINE : ${totalFixed} contextes mis à jour.`);
}

fixContexts().catch(console.error);
