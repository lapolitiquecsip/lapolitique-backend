
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

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

  // Charger les données T1 et T2 (UTF-8)
  const t1Data = fs.readFileSync(T1_PATH, 'utf-8');
  const t2Data = fs.readFileSync(T2_PATH, 'utf-8');

  const parseElectionCSV = (content: string) => {
    const lines = content.split('\n');
    const results: any[] = [];
    
    // On skip le header (souvent complexe sur ces fichiers)
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(';');
        
        const dept = cols[1];
        const circoMatch = cols[3]?.match(/\d+/);
        const circo = circoMatch ? parseInt(circoMatch[0]) : parseInt(cols[2]?.slice(-2) || "1");
        if (!dept || !circo) continue;

        const candidates: any[] = [];
        for (let j = 18; j < cols.length; j += 9) {
            const lastName = cols[j+2];
            const firstName = cols[j+3];
            let votesRaw = cols[j+5] || "";
            const percent = cols[j+7];
            
            if (lastName && firstName && votesRaw) {
                // Nettoyage agressif du nombre (virer tout ce qui n'est pas un chiffre)
                const votes = parseInt(votesRaw.replace(/[^\d]/g, ''));
                const party = cols[j+1];
                candidates.push({
                    name: `${firstName} ${lastName}`,
                    party: party ? party.replace(/"/g, '') : '',
                    votes: isNaN(votes) ? 0 : votes,
                    percent: percent.replace(/"/g, '')
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
    // Normaliser le nom du département
    const normDept = (d: string) => {
        if (!d) return "";
        let name = d.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/-/g, ' ');
        if (name === "099" || name.includes("etranger")) return "francais etablis hors de france";
        if (name === "986" || name.includes("wallis")) return "wallis et futuna";
        if (name === "975" || name.includes("saint pierre")) return "saint pierre et miquelon";
        if (name === "977" || name === "978" || name.includes("saint barthelemy") || name.includes("saint martin")) return "saint martin/saint barthelemy";
        return name;
    };
    
    const depNorm = normDept(dep.department);

    // Trouver le résultat de la circo au T2 ou T1
    let circoResult = t2Results.find(r => normDept(r.department) === depNorm && r.circo === dep.constituency_number);
    let round = 2;

    if (!circoResult) {
        circoResult = t1Results.find(r => normDept(r.department) === depNorm && r.circo === dep.constituency_number);
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
    } else {
        console.log(`> Pas de résultats trouvés pour ${dep.first_name} ${dep.last_name} (${dep.department} - ${dep.constituency_number})`);
    }
  }

  console.log(`\nTERMINE : ${updated} scores électoraux injectés.`);
}

main().catch(console.error);
