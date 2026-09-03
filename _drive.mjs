import 'dotenv/config';
import fs from 'node:fs';
import { summarizeLegislativeDossiers } from './src/scripts/legislative/summarize.ts';
const ids=fs.readFileSync('_recent_missing.txt','utf8').split('\n').map(s=>s.trim()).filter(Boolean);
const CHUNK=100; let total=0;
for(let i=0;i<ids.length;i+=CHUNK){
  const batch=ids.slice(i,i+CHUNK);
  process.env.SUMMARY_DOSSIER_IDS=batch.join(',');
  console.log(`=== LOT ${Math.floor(i/CHUNK)+1} : ${batch.length} dossiers (${i+batch.length}/${ids.length}) ===`);
  try{ const g=await summarizeLegislativeDossiers(); total+=(g||0);}catch(e){console.error('lot err:',e.message);}
}
console.log(`=== BACKFILL RÉCENTS TERMINÉ. ~${total} analyses générées. ===`);
