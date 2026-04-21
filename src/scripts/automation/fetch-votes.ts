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
    
    // NEW: Fetch existing deputies to filter votes
    console.log(`> Fetching active deputies from DB...`);
    const { data: activeDeputies, error: dError } = await supabase
        .from('deputies')
        .select('an_id');
    
    if (dError) throw new Error(`Could not fetch deputies: ${dError.message}`);
    const activeAnIds = new Set(activeDeputies.map(d => d.an_id.trim().toUpperCase()));
    console.log(`  - Found ${activeAnIds.size} active deputies in your database.`);

    let scrutinsCount = 0;
    let votesCount = 0;

    for (const entry of zipEntries) {
      if (!entry.entryName.endsWith('.json')) continue;
      
      const content = JSON.parse(entry.getData().toString('utf8'));
      const s = content.scrutin;
      

      // Classification (Loi vs Amendement)
      const titre = (s.titre || s.objet.libelle || "").toLowerCase();
      let type = "AUTRE";
      if (titre.includes("amendement")) {
        type = "AMENDEMENT";
      } else if (titre.includes("projet de loi") || titre.includes("proposition de loi")) {
        type = "LOI";
      }

      // Catégorisation par thématique
      const themes = [
        { name: "Économie & Finances", keywords: ["finances", "budget", "fiscal", "pib", "impôt", "taxe", "économie", "sociale", "secteur public"] },
        { name: "Sécurité & Intérieur", keywords: ["sécurité", "police", "gendarmerie", "terrorisme", "intérieur", "ordre public", "immigration"] },
        { name: "Santé & Social", keywords: ["santé", "hôpital", "médical", "soins", "sécurité sociale", "retraites", "travail"] },
        { name: "Environnement", keywords: ["climat", "écologie", "environnement", "biodiversité", "énergie", "nucléaire", "eau", "transition"] },
        { name: "Éducation & Culture", keywords: ["école", "enseignement", "université", "éducation", "culture", "médias", "sport"] },
        { name: "Justice", keywords: ["justice", "pénal", "tribunal", "magistrat", "prison", "loi"] },
        { name: "International", keywords: ["affaires étrangères", "international", "europe", "union européenne", "diplomatie", "traité"] },
        { name: "Agriculture", keywords: ["agriculture", "ferme", "agricole", "pêche", "alimentation"] }
      ];

      let category = "Autres";
      for (const t of themes) {
        if (t.keywords.some(k => titre.includes(k))) {
          category = t.name;
          break;
        }
      }

      // Dossier URL construction
      let dossierUrl = null;
      const refLeg = s.objet.referenceLegislative;
      if (refLeg) {
        // Simple heuristic for AN dossier URLs
        dossierUrl = `https://www.assemblee-nationale.fr/dyn/17/dossiers_legislatifs/${refLeg}`;
      }

      const scrutinData = {
        id: s.uid,
        numero: parseInt(s.numero),
        date_scrutin: s.dateScrutin,
        objet: s.objet.libelle,
        type: type,
        category: category,
        resultat: s.sort.libelle,
        institution: 'AN',
        dossier_url: dossierUrl
      };

      // 1. Upsert Scrutin
      await supabase.from('scrutins').upsert(scrutinData, { onConflict: 'id' });
      scrutinsCount++;

      // 2. Extract and Flatten Votes
      const votes: any[] = [];
      const groups = s.ventilationVotes?.organe?.groupes?.groupe;
      
      if (!groups) continue;

      const processNominatif = (nominatif: any) => {
        if (!nominatif) return;
        
        const categories = [
          { key: 'pours', subKey: 'votant', pos: 'POUR' },
          { key: 'contres', subKey: 'votant', pos: 'CONTRE' },
          { key: 'abstentions', subKey: 'votant', pos: 'ABSTENTION' },
          { key: 'nonVotants', subKey: 'votant', pos: 'NON_VOTANT' }
        ];

        categories.forEach(({ key, subKey, pos }) => {
          const catObj = nominatif[key];
          if (!catObj || !catObj[subKey]) return;
          const list = Array.isArray(catObj[subKey]) ? catObj[subKey] : [catObj[subKey]];
          list.forEach((d: any) => {
            if (d.acteurRef) {
              const actorId = d.acteurRef.trim().toUpperCase();
              if (activeAnIds.has(actorId)) {
                votes.push({
                  deputy_an_id: actorId,
                  scrutin_id: s.uid,
                  position: pos,
                  date_scrutin: s.dateScrutin
                });
              }
            }
          });
        });
      };

      const groupsList = Array.isArray(groups) ? groups : [groups];
      groupsList.forEach((g: any) => {
        processNominatif(g.vote?.decompteNominatif);
      });

      if (votes.length > 0) {
        const { error: vError } = await supabase.from('deputy_votes').upsert(votes, { onConflict: 'deputy_an_id, scrutin_id' });
        if (!vError) {
            votesCount += votes.length;
            console.log(`  [OK] ${s.uid}: Found and updated ${votes.length} votes.`);
        } else {
            console.warn(`  [FAIL] ${s.uid}: Upsert error:`, vError.message);
        }
      }

      if (scrutinsCount % 100 === 0) {
        console.log(`\n--- Status Update: Processed ${scrutinsCount} files. Total votes in DB: ${votesCount} ---\n`);
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
