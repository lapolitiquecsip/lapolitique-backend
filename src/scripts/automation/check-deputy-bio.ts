
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Please provide a slug.");
    return;
  }

  const { data: deputy, error } = await supabase
    .from('deputies')
    .select('slug, biography')
    .eq('slug', slug)
    .single();

  if (error) {
    console.error("Error:", error);
    return;
  }

  console.log(`Slug: ${deputy.slug}`);
  console.log(`Bio Length: ${deputy.biography?.length || 0}`);
  console.log(`Bio: ${deputy.biography}`);
}

main().catch(console.error);
