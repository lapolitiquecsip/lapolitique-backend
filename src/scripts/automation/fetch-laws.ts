import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadAndUnzip } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const LAWS_URL = 'https://data.assemblee-nationale.fr/static/openData/repository/17/loi/dossiers_legislatifs/Dossiers_Legislatifs_json.zip';
const DATA_DIR = path.join(__dirname, '../../../data/laws_an');

async function main() {
  console.log('--- SYNC ASSEMBLEE NATIONALE LAWS ---');

  await downloadAndUnzip(LAWS_URL, DATA_DIR);

  const entriesDir = path.join(DATA_DIR, 'json/dossier');
  if (!fs.existsSync(entriesDir)) {
    console.error('Error: json/dossier directory not found in zip.');
    return;
  }

  const files = fs.readdirSync(entriesDir);
  console.log(`> Processing ${files.length} legislative folders...`);

  let updatedCount = 0;

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const raw = fs.readFileSync(path.join(entriesDir, file), 'utf8');
    const data = JSON.parse(raw).dossier;

    // Filter interesting ones (e.g. PJL or PPL)
    const title = data.titreAbsolu || data.libelle;
    const date = data.initiateur?.acteurs?.acteur?.mandat?.dateDebut || new Date().toISOString().split('T')[0];

    const law = {
      title,
      summary: data.resume || "Pas de résumé disponible pour le moment.",
      context: `Dossier législatif n°${data.uid}`,
      content: data.exposeMotif || "En cours de discussion...",
      impact: "À évaluer suite aux débats parlementaires.",
      date_adopted: data.cycleDeVie.etatId === 'Adopté' ? data.cycleDeVie.chrono.dateAdoption : null,
      category: data.indexation?.thematiques?.thematique?.libelle || 'Législation',
      source_urls: [`https://www.assemblee-nationale.fr/dyn/17/dossiers_legislatifs/${data.uid}`]
    };

    // We only import the most recent or major ones for now to avoid overloading
    if (updatedCount < 100) { // Limit for first batch
      const { error } = await supabase
        .from('laws')
        .upsert(law, { onConflict: 'title' }); // Simplistic conflict check
      if (!error) updatedCount++;
    }
  }

  console.log(`\nTERMINE : ${updatedCount} dossiers législatifs synchronisés.`);
}

main().catch(console.error);
