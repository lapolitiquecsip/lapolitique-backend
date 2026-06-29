import { supabase } from '../../config/supabase.js';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadAndUnzip } from './utils.js';
import { logStart, logSuccess, logError } from '../../lib/monitoring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const LAWS_URL = 'https://data.assemblee-nationale.fr/static/openData/repository/17/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip';
const DATA_DIR = path.join(__dirname, '../../../data/laws_an');

export async function syncLawsAN() {
  const hcId = process.env.HEALTHCHECK_ID_LAWS;
  await logStart('syncLawsAN', hcId);

  try {
    await downloadAndUnzip(LAWS_URL, DATA_DIR);

    // Load all deputies to build a map of an_id -> full name
    const { data: dbDeputies } = await supabase
      .from('deputies')
      .select('an_id, first_name, last_name');
    const deputyMap = new Map<string, string>();
    if (dbDeputies) {
      for (const d of dbDeputies) {
        if (d.an_id) {
          deputyMap.set(d.an_id.trim(), `${d.first_name} ${d.last_name}`);
        }
      }
    }

  const entriesDir = path.join(DATA_DIR, 'json/dossierParlementaire');
  if (!fs.existsSync(entriesDir)) {
    console.error('Error: json/dossier directory not found in zip.');
    return;
  }

  const files = fs.readdirSync(entriesDir);
  console.log(`> Extracting titles from ${files.length} folders...`);

  const titlesInFolder = new Set<string>();
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = fs.readFileSync(path.join(entriesDir, file), 'utf8');
      const dossier = JSON.parse(raw).dossierParlementaire;
      if (dossier) {
        const title = dossier.titreDossier?.titre || dossier.libelle || "Titre inconnu";
        titlesInFolder.add(title.trim());
      }
    } catch (e) {}
  }

  console.log(`> Checking database for existing laws (${titlesInFolder.size} unique titles)...`);
  const existingTitles = new Set<string>();
  const titlesArray = Array.from(titlesInFolder);
  const chunkSize = 50;

  for (let i = 0; i < titlesArray.length; i += chunkSize) {
    const chunk = titlesArray.slice(i, i + chunkSize);
    const { data: existing, error } = await supabase
      .from('laws')
      .select('title')
      .in('title', chunk);
    
    if (error) {
      console.error('Error checking existing titles:', error.message);
    }
    
    if (existing) {
      for (const row of existing) {
        existingTitles.add(row.title.trim());
      }
    }
  }

  console.log(`> Processing ${files.length} legislative folders...`);

  let updatedCount = 0;

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const raw = fs.readFileSync(path.join(entriesDir, file), 'utf8');
    const dossier = JSON.parse(raw).dossierParlementaire;

    if (!dossier) continue;

    const title = dossier.titreDossier?.titre || dossier.libelle || "Titre inconnu";
    
    if (existingTitles.has(title.trim())) continue; // Skip existing laws quickly

    const category = dossier.procedureParlementaire?.libelle || 'Législation';
    const uid = dossier.uid;

    // ONLY import dossiers from the 17th legislature
    if (!uid || !uid.startsWith('DLR5L17')) continue;

    // Parse the author(s) from JSON
    let author = category.toLowerCase().includes('projet') ? 'Le Gouvernement' : 'Député(s)';
    const init = dossier.initiateur;
    if (init && init.acteurs) {
      const acteurs = init.acteurs.acteur;
      const actorRefs: string[] = [];
      
      if (Array.isArray(acteurs)) {
        for (const act of acteurs) {
          if (act.acteurRef) actorRefs.push(act.acteurRef.trim());
        }
      } else if (acteurs && acteurs.acteurRef) {
        actorRefs.push(acteurs.acteurRef.trim());
      }
      
      const authorNames = actorRefs
        .map(ref => deputyMap.get(ref))
        .filter(Boolean) as string[];
        
      if (authorNames.length > 0) {
        author = authorNames.join(', ');
      }
    }

    const law = {
      title,
      summary: `Dossier législatif n°${uid}. Ce document regroupe l'ensemble des étapes et actes relatifs à cette proposition ou ce projet de loi.`,
      context: `Procédure : ${category}`,
      content: "Détails du dossier disponibles sur le site de l'Assemblée nationale.",
      impact: "À évaluer suite aux débats parlementaires.",
      category: category,
      author: author,
      source_urls: [`https://www.assemblee-nationale.fr/dyn/17/dossiers_legislatifs/${uid}`]
    };

    if (updatedCount < 5000) {
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

