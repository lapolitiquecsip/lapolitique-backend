
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

async function fixContext() {
  console.log('--- FIXING DATABASE CONTEXT PREFIXES ---');
  
  const { data: laws, error } = await supabase
    .from('laws')
    .select('id, context');

  if (error) {
    console.error(error);
    return;
  }

  console.log(`Found ${laws.length} laws. Checking for missing prefixes...`);

  let count = 0;
  for (const law of laws) {
    if (law.context && !law.context.startsWith('[')) {
      const newContext = `[1900-01-01] ${law.context}`;
      await supabase
        .from('laws')
        .update({ context: newContext })
        .eq('id', law.id);
      count++;
    }
  }

  console.log(`Updated ${count} laws with default [1900-01-01] prefix.`);
}

fixContext();
