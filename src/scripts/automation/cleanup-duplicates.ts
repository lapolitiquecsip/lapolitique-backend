import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function cleanup() {
  console.log('=== START DUPLICATES CLEANUP ===');
  
  // 1. Fetch all laws using pagination
  console.log('Fetching all laws in batches of 1000...');
  const allLaws: any[] = [];
  let page = 0;
  const pageSize = 1000;
  
  while (true) {
    const { data, error } = await supabase
      .from('laws')
      .select('id, title, summary, content, created_at')
      .range(page * pageSize, (page + 1) * pageSize - 1);
      
    if (error) {
      console.error('Error fetching page ' + page + ':', error.message);
      return;
    }
    
    if (!data || data.length === 0) break;
    allLaws.push(...data);
    console.log(`  Fetched page ${page}: ${data.length} items (total so far: ${allLaws.length})`);
    
    if (data.length < pageSize) break;
    page++;
  }
  
  console.log(`Total laws fetched: ${allLaws.length}`);
  
  // 2. Group by title
  const groups = new Map<string, any[]>();
  for (const law of allLaws) {
    const titleKey = law.title.trim();
    if (!groups.has(titleKey)) {
      groups.set(titleKey, []);
    }
    groups.get(titleKey)!.push(law);
  }
  
  const idsToDelete: string[] = [];
  let duplicateGroupsCount = 0;
  
  // 3. Find duplicates to delete
  for (const [title, list] of groups.entries()) {
    if (list.length <= 1) continue;
    
    duplicateGroupsCount++;
    
    // Sort to find the best row to keep
    // Criteria:
    // 1. Prefer rows with a DeepSeek summary (doesn't start with "Dossier législatif")
    // 2. Prefer rows with longer content/description
    // 3. Fall back to oldest created_at
    const sorted = [...list].sort((a, b) => {
      const aIsGeneric = a.summary?.startsWith('Dossier législatif') || !a.summary;
      const bIsGeneric = b.summary?.startsWith('Dossier législatif') || !b.summary;
      
      if (aIsGeneric && !bIsGeneric) return 1; // b is better
      if (!aIsGeneric && bIsGeneric) return -1; // a is better

      const aHasAuthor = a.author && a.author !== 'Député(s)' && a.author !== 'Non spécifié';
      const bHasAuthor = b.author && b.author !== 'Député(s)' && b.author !== 'Non spécifié';
      if (aHasAuthor && !bHasAuthor) return -1; // a is better
      if (!aHasAuthor && bHasAuthor) return 1;  // b is better
      
      // If both are generic or both are DeepSeek summaries, compare length of content
      const aLength = (a.content || '').length + (a.summary || '').length;
      const bLength = (b.content || '').length + (b.summary || '').length;
      
      if (aLength !== bLength) return bLength - aLength; // Prefer longer
      
      // Fallback to older created_at
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    
    const keepRow = sorted[0];
    const discardRows = sorted.slice(1);
    
    for (const discard of discardRows) {
      idsToDelete.push(discard.id);
    }
  }
  
  console.log(`Found ${duplicateGroupsCount} groups with duplicates.`);
  console.log(`Total duplicate rows to delete: ${idsToDelete.length}`);
  
  if (idsToDelete.length === 0) {
    console.log('No duplicates found. Cleanup finished.');
    return;
  }
  
  // 4. Delete duplicates in batches of 100
  const batchSize = 100;
  console.log(`Deleting ${idsToDelete.length} rows in batches of ${batchSize}...`);
  
  for (let i = 0; i < idsToDelete.length; i += batchSize) {
    const batch = idsToDelete.slice(i, i + batchSize);
    const { error: dError } = await supabase
      .from('laws')
      .delete()
      .in('id', batch);
      
    if (dError) {
      console.error(`Error deleting batch starting at index ${i}:`, dError.message);
    } else {
      console.log(`  Deleted batch ${i / batchSize + 1}/${Math.ceil(idsToDelete.length / batchSize)}: ${batch.length} rows`);
    }
  }
  
  console.log('=== DUPLICATES CLEANUP FINISHED ===');
}

cleanup().catch(console.error);
