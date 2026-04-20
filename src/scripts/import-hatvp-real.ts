import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { XMLParser } from 'fast-xml-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('--- IMPORTATION DES DONNEES HATVP REELLES ---');

  const xmlPath = path.join(__dirname, '../../data/declarations.xml');
  if (!fs.existsSync(xmlPath)) {
    console.error('Erreur: data/declarations.xml introuvable.');
    return;
  }

  console.log('> Lecture du fichier XML...');
  const xmlData = fs.readFileSync(xmlPath, 'utf-8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: true,
  });
  
  console.log('> Parsing XML (cette étape peut être longue)...');
  const jsonObj = parser.parse(xmlData);
  const rawDeclarations = jsonObj.declarations.declaration;

  console.log(`> ${rawDeclarations.length} déclarations trouvées dans le fichier.`);

  // Load deputies from DB to match them
  const { data: deputies, error: depError } = await supabase
    .from('deputies')
    .select('id, first_name, last_name, biography');

  if (depError) {
    console.error('Erreur Supabase:', depError.message);
    return;
  }

  console.log(`> Correspondance avec ${deputies?.length} députés en cours...`);

  let matchedCount = 0;
  let updatedCount = 0;

  for (const dep of deputies || []) {
    // Find matching declarations
    // Some deputies might have multiple declarations (one from 2022, one from 2024, etc.)
    // We want the most recent "députe" declaration.
    const matches = rawDeclarations.filter((d: any) => {
      const declarant = d.general?.declarant;
      if (!declarant) return false;
      
      const firstNameMatch = dep.first_name.toLowerCase() === declarant.prenom?.toLowerCase();
      const lastNameMatch = dep.last_name.toLowerCase() === declarant.nom?.toLowerCase();
      
      return firstNameMatch && lastNameMatch;
    });

    if (matches.length === 0) continue;

    matchedCount++;
    
    // Pick the most recent declaration (usually the last one in the list or filtered by date)
    // For now, let's take the last one as it's often the latest entry in consolidated feeds
    const latestDecl = matches[matches.length - 1];

    // --- ASSOCIATIONS ---
    const associations = [];
    // Could parse mandats electroreaux / benevolats etc.

    const integrity_json = JSON.stringify({
      associations: associations,
      isReal: true,
      source: "HATVP",
      declarationDate: latestDecl.dateDepot
    });

    // Update DB (preserve bio, replace integrity block)
    const bio = dep.biography || '';
    const updatedBio = bio.split('<!-- INTEGRITY_START -->')[0] + 
      `\n\n<!-- INTEGRITY_START -->\n<!-- ${integrity_json} -->\n<!-- INTEGRITY_END -->`;

    const { error: updateError } = await supabase
      .from('deputies')
      .update({ biography: updatedBio })
      .eq('id', dep.id);

    if (!updateError) {
      updatedCount++;
    }
  }

  console.log(`\n--- RESULTATS ---`);
  console.log(`> Députés trouvés dans HATVP : ${matchedCount}`);
  console.log(`> Députés mis à jour : ${updatedCount}`);
  console.log(`> Terminé.`);
}

main().catch(console.error);
