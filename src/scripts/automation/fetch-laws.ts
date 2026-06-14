import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadAndUnzip } from './utils.js';
import { logStart, logSuccess, logError } from '../../lib/monitoring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const LAWS_URL = 'https://data.assemblee-nationale.fr/static/openData/repository/17/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip';
const DATA_DIR = path.join(__dirname, '../../../data/laws_an');

export async function syncLawsAN() {
  const hcId = process.env.HEALTHCHECK_ID_LAWS;
  await logStart('syncLawsAN', hcId);

  try {
    await downloadAndUnzip(LAWS_URL, DATA_DIR);

  const entriesDir = path.join(DATA_DIR, 'json/dossierParlementaire');
  if (!fs.existsSync(entriesDir)) {
    console.error('Error: json/dossier directory not found in zip.');
    return;
  }

  const { data: existingLaws } = await supabase.from('laws').select('title');
  const existingTitles = new Set(existingLaws?.map((l: any) => l.title) || []);

  const files = fs.readdirSync(entriesDir);
  console.log(`> Processing ${files.length} legislative folders...`);

  let updatedCount = 0;

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const raw = fs.readFileSync(path.join(entriesDir, file), 'utf8');
    const dossier = JSON.parse(raw).dossierParlementaire;

    if (!dossier) continue;

    const title = dossier.titreDossier?.titre || dossier.libelle || "Titre inconnu";
    
    if (existingTitles.has(title)) continue; // Skip existing laws quickly

    const category = dossier.procedureParlementaire?.libelle || 'Législation';
    const uid = dossier.uid;

    const law = {
      title,
      summary: `Dossier législatif n°${uid}. Ce document regroupe l'ensemble des étapes et actes relatifs à cette proposition ou ce projet de loi.`,
      context: `Procédure : ${category}`,
      content: "Détails du dossier disponibles sur le site de l'Assemblée nationale.",
      impact: "À évaluer suite aux débats parlementaires.",
      category: category,
      source_urls: [`https://www.assemblee-nationale.fr/dyn/17/dossiers_legislatifs/${uid}`]
    };

    if (updatedCount < 100) {
      const { error } = await supabase
        .from('laws')
        .insert(law);
      if (!error) {
        updatedCount++;
        existingTitles.add(title);
      }
      else console.error(`Error upserting ${uid}:`, error.message);
    }
  }

    console.log(`\nTERMINE : ${updatedCount} dossiers législatifs synchronisés.`);
    await logSuccess('syncLawsAN', updatedCount, hcId);
    return updatedCount;

  } catch (err: any) {
    await logError('syncLawsAN', err, hcId);
    throw err;
  }
}

const nodePath = fs.realpathSync(process.argv[1]);
const currentPath = fileURLToPath(import.meta.url);
if (nodePath === currentPath || nodePath.endsWith('fetch-laws.ts') || nodePath.endsWith('fetch-laws.js')) {
  syncLawsAN().catch(console.error);
}

