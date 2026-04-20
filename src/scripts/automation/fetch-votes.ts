import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import AdmZip from 'adm-zip';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SCRUTINS_ZIP_URL = 'https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip';

async function fetchAndParseVotes() {
  console.log('--- START VOTES SYNCHRONIZATION ---');
  
  try {
    console.log(`> Downloading archive from ${SCRUTINS_ZIP_URL}...`);
    const response = await fetch(SCRUTINS_ZIP_URL);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    
    const buffer = await response.arrayBuffer();
    const zip = new AdmZip(Buffer.from(buffer));
    const zipEntries = zip.getEntries();
    
    console.log(`> Found ${zipEntries.length} entries in ZIP`);

    let scrutinsCount = 0;
    let votesCount = 0;

    for (const entry of zipEntries) {
      if (!entry.entryName.endsWith('.json')) continue;
      
      const content = JSON.parse(entry.getData().toString('utf8'));
      const s = content.scrutin;
      
      if (!s) continue;

      const scrutinData = {
        id: s.uid,
        numero: parseInt(s.numero),
        date_scrutin: s.dateScrutin,
        objet: s.objet.libelle,
        resultat: s.sort.libelle,
        institution: 'AN'
      };

      // 1. Upsert Scrutin
      const { error: sError } = await supabase
        .from('scrutins')
        .upsert(scrutinData, { onConflict: 'id' });

      if (sError) {
        console.error(`Error upserting scrutin ${s.uid}:`, sError.message);
        continue;
      }
      scrutinsCount++;

      // 2. Extract and Flatten Votes
      const votes: any[] = [];
      const groups = s.ventilationVotes?.organe?.groupes?.groupe;
      
      if (!groups) continue;

      const processPositions = (decideurs: any, position: string) => {
        if (!decideurs) return;
        const list = Array.isArray(decideurs) ? decideurs : [decideurs];
        list.forEach((d: any) => {
          if (d.acteurRef) {
            votes.push({
              deputy_an_id: d.acteurRef,
              scrutin_id: s.uid,
              position: position
            });
          }
        });
      };

      const groupsList = Array.isArray(groups) ? groups : [groups];
      groupsList.forEach((g: any) => {
        const v = g.vote;
        if (!v) return;
        
        processPositions(v.pours?.decideur, 'POUR');
        processPositions(v.contres?.decideur, 'CONTRE');
        processPositions(v.abstentions?.decideur, 'ABSTENTION');
        processPositions(v.nonVotants?.decideur, 'NON_VOTANT');
      });

      if (votes.length > 0) {
        // Chunked UPSERT to avoid hitting Supabase limits
        const chunkSize = 100;
        for (let i = 0; i < votes.length; i += chunkSize) {
            const chunk = votes.slice(i, i + chunkSize);
            const { error: vError } = await supabase
                .from('deputy_votes')
                .upsert(chunk, { onConflict: 'deputy_an_id, scrutin_id' });
            
            if (vError) {
                // If some deputy_an_id doesn't exist in DB, this might fail
                // We should ideally filter to only existing deputies, but let's see
                if (!vError.message.includes('foreign key constraint')) {
                    console.warn(`Partial failure in votes upsert for ${s.uid}:`, vError.message);
                }
            } else {
                votesCount += chunk.length;
            }
        }
      }

      if (scrutinsCount % 10 === 0) {
        console.log(`  - Processed ${scrutinsCount} scrutins...`);
      }
      
      // Limit for testing (uncomment for full run)
      // if (scrutinsCount >= 50) break;
    }

    console.log(`\n✅ SYNC COMPLETED: ${scrutinsCount} scrutins and ~${votesCount} votes updated.`);

  } catch (err) {
    console.error('FAILED to sync votes:', err);
  }
}

fetchAndParseVotes();
