import { supabase } from '../config/supabase.js';
import AdmZip from 'adm-zip';

async function runDebug() {
  console.log('--- DEBUG START ---');
  
  // 1. Get Benjamin Dirx from DB
  const { data: deputy } = await supabase
    .from('deputies')
    .select('an_id, first_name, last_name')
    .eq('last_name', 'Dirx')
    .single();
    
  if (!deputy) {
    console.error('Benjamin Dirx not found in DB');
    return;
  }
  
  const dbId = deputy.an_id;
  console.log(`DB ID for Dirx: |${dbId}| (Type: ${typeof dbId})`);

  // 2. Download and Search in ZIP
  const res = await fetch('https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip');
  const buffer = await res.arrayBuffer();
  const zip = new AdmZip(Buffer.from(buffer));
  const entries = zip.getEntries().filter(e => e.entryName.endsWith('.json'));

  console.log(`Searching through ${entries.length} files...`);

  for (const entry of entries) {
    const raw = entry.getData().toString('utf8');
    if (raw.includes('PA722382')) {
      console.log(`Match found in file: ${entry.entryName}`);
      const content = JSON.parse(raw);
      
      // Navigate to where the ID is (assuming typical structure)
      const groups = content.scrutin?.ventilationVotes?.organe?.groupes?.groupe;
      if (groups) {
        const groupsList = Array.isArray(groups) ? groups : [groups];
        for (const g of groupsList) {
          const positions = [g.vote?.pours?.pour, g.vote?.contres?.contre].flat().filter(Boolean);
          for (const list of positions) {
            const pList = Array.isArray(list) ? list : [list];
            for (const p of pList) {
              if (p.acteurRef === 'PA722382' || p.acteurRef.includes('PA722382')) {
                console.log(`JSON ActorRef found: |${p.acteurRef}| (Type: ${typeof p.acteurRef})`);
                console.log(`Comparison: dbId === p.acteurRef -> ${dbId === p.acteurRef}`);
                process.exit(0);
              }
            }
          }
        }
      }
    }
  }
  
  console.log('Finished search, no literal match found in parsing.');
}

runDebug();
