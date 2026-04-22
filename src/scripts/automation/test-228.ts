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

async function main() {
  const { data: votes, error } = await supabase.from('votes').select('deputy_id');
  if (error) { console.error(error); return; }
  
  const counts: Record<string, number> = {};
  votes.forEach(v => counts[v.deputy_id] = (counts[v.deputy_id] || 0) + 1);
  
  const target = Object.entries(counts).find(([id, c]) => c === 228);
  if (target) {
    const { data: dep } = await supabase.from('deputies').select('slug, first_name, last_name, an_id').eq('an_id', target[0]).single();
    console.log('Found deputy with 228 votes:', dep);
    
    // Now let's fetch their votes and simulate extractLawInfo
    const { data: theirVotes } = await supabase.from('votes').select('id, scrutins(objet, category)').eq('deputy_id', target[0]);
    
    let globalMatchCount = 0;
    let articleMatchCount = 0;
    let fallbackMatchCount = 0;
    
    theirVotes?.forEach(v => {
      const objet = v.scrutins?.objet || '';
      
      const globalMatch = objet.match(/l'ensemble d[ue]\s+(?:projet|proposition) de loi\s+(?:relatif à|visant à|autorisant|relative à)?\s*(.*?)(?:\s*\(|$)/i);
      if (globalMatch) { globalMatchCount++; return; }
      
      const articleMatch = objet.match(/l'article\s+(.*?)\s+de la\s+(?:proposition|projet) de loi\s+(?:relatif à|visant à|autorisant|relative à)?\s*(.*?)(?:\s*\(|$)/i);
      if (articleMatch) {
         if (objet.toLowerCase().includes("l'amendement n°")) return; // amendment rejected
         articleMatchCount++; 
         return; 
      }
      
      const genericMatch = objet.match(/(?:projet|proposition) de loi\s+(?:relatif à|visant à|autorisant|relative à)?\s*(.*?)(?:\s*\(|$)/i);
      if (genericMatch) { fallbackMatchCount++; return; }
    });
    
    console.log('Global:', globalMatchCount, 'Article:', articleMatchCount, 'Fallback:', fallbackMatchCount);
    console.log('Total visible grouped:', globalMatchCount + articleMatchCount + fallbackMatchCount);

  } else {
    console.log('No deputy with exactly 228 votes found. Printing counts near 228:');
    console.log(Object.entries(counts).filter(([id, c]) => c > 220 && c < 240));
  }
}

main();
