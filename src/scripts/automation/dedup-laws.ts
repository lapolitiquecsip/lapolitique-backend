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

async function deduplicateAndFix() {
  console.log('--- DEDUPLICATING AND FIXING LAWS ---');

  const { data: laws, error } = await supabase
    .from('laws')
    .select('id, title, context')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error:', error);
    return;
  }

  const seenTitles = new Set();
  const toDelete = [];
  const toUpdate = [];

  for (const law of laws) {
    if (seenTitles.has(law.title)) {
      toDelete.push(law.id);
    } else {
      seenTitles.add(law.title);
      // Also ensure context has brackets
      if (law.context && !law.context.startsWith('[')) {
          toUpdate.push({ id: law.id, context: `[1900-01-01] ${law.context}` });
      }
    }
  }

  console.log(`> Found ${toDelete.length} duplicates and ${toUpdate.length} laws to fix.`);

  if (toDelete.length > 0) {
    const { error: delError } = await supabase.from('laws').delete().in('id', toDelete);
    if (delError) console.error('Delete error:', delError);
    else console.log('✅ Duplicates deleted.');
  }

  for (const item of toUpdate) {
    await supabase.from('laws').update({ context: item.context }).eq('id', item.id);
  }
  console.log('✅ Contexts fixed.');
}

deduplicateAndFix().catch(console.error);
