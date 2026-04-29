
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import iconv from 'iconv-lite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const T1_PATH = path.join(__dirname, '../../data/elections/t1.csv');
const T2_PATH = path.join(__dirname, '../../data/elections/t2.csv');

async function main() {
  console.log('--- ENRICHISSEMENT RÉSULTATS ÉLECTORAUX (LÉGISLATIVES 2024) ---');

  const { data: deputies, error: depError } = await supabase
    .from('deputies')
    .select('id, first_name, last_name, department, constituency_number');
  
  if (depError) throw depError;
  console.log(`> ${deputies.length} députés à traiter.`);

  // Charger les données T1 et T2
  const t1Data = iconv.decode(fs.readFileSync(T1_PATH), 'win1252');
  const t2Data = iconv.decode(fs.readFileSync(T2_PATH), 'win1252');

  const parseElectionCSV = (content: string) => {
    const lines = content.split('\n');
    const results: any[] = [];
    
    // On skip le header (souvent complexe sur ces fichiers)
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(';');
        
        const dept = cols[1];
        const circo = cols[3]?.match(/\d+/)?.[0];
        if (!dept || !circo) continue;

        const candidates: any[] = [];
        // Les candidats commencent généralement vers la colonne 20 et se répètent par blocs de 7 ou 8
        // On va chercher dynamiquement les blocs qui ont un nom
        for (let j = 18; j < cols.length; j += 10) { // Hypothèse: bloc de 10
            const lastName = cols[j+2];
            const firstName = cols[j+3];
            const votes = cols[j+5];
            const percent = cols[j+7];
            
            if (lastName && firstName && votes) {
                candidates.push({
                    name: `${firstName} ${lastName}`,
                    votes: parseInt(votes),
                    percent: percent
                });
            }
        }

        results.push({
            department: dept,
            circo: parseInt(circo),
            candidates: candidates.sort((a, b) => b.votes - a.votes)
        });
    }
    return results;
  };

  console.log("> Parsing des fichiers CSV...");
  const t1Results = parseElectionCSV(t1Data);
  const t2Results = parseElectionCSV(t2Data);

  let updated = 0;

  for (const dep of deputies) {
    // Normaliser le nom du département (certains ont des accents ou des tirets différents)
    const normDept = (d: string) => d.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/-/g, ' ');
    
    // Trouver le résultat de la circo au T2 (si élu au T2) ou T1 (si élu au T1)
    let circoResult = t2Results.find(r => normDept(r.department) === normDept(dep.department) && r.circo === dep.constituency_number);
    let round = 2;

    if (!circoResult || !circoResult.candidates.some(c => normDept(c.name).includes(normDept(dep.last_name)))) {
        circoResult = t1Results.find(r => normDept(r.department) === normDept(dep.department) && r.circo === dep.constituency_number);
        round = 1;
    }

    if (circoResult) {
        const scoreData = {
            round: round,
            candidates: circoResult.candidates.slice(0, 5) // Top 5
        };

        const { error: upError } = await supabase
            .from('deputies')
            .update({ election_score: scoreData })
            .eq('id', dep.id);

        if (!upError) updated++;
    }
  }

  console.log(`\nTERMINE : ${updated} scores électoraux injectés.`);
}

main().catch(console.error);
