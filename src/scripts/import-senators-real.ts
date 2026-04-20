import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function importSenators() {
  console.log('Fetching senators data from official Open Data Senat...');
  
  try {
    const response = await fetch('https://data.senat.fr/data/senateurs/ODSEN_GENERAL.json');
    const data = await response.json();
    
    // The data is wrapped in a "results" array
    const activeSenators = data.results.filter((s: any) => s.Etat === 'ACTIF');

    console.log(`Processing ${activeSenators.length} active senators...`);

    const generateSlug = (first: string, last: string): string => {
      const normalize = (s: string) =>
        s.toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");
      return `${normalize(first)}-${normalize(last)}`;
    };

    const generatePhotoUrl = (first: string, last: string, matricule: string): string => {
      const normalize = (s: string) =>
        s.toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_+|_$/g, "");
      
      const id = matricule.toLowerCase();
      // Heuristic: Newer senators (matricule starts with 2) often use _carre suffix
      const suffix = matricule.startsWith('2') ? '_carre' : '';
      return `https://www.senat.fr/senimg/${normalize(last)}_${normalize(first)}${id}${suffix}.jpg`;
    };

    const senatorsToInsert = activeSenators.map((s: any) => {
      return {
        first_name: s.Prenom_usuel,
        last_name: s.Nom_usuel,
        photo_url: generatePhotoUrl(s.Prenom_usuel, s.Nom_usuel, s.Matricule),
        party: s.Groupe_politique,
        department: s.Circonscription,
        department_code: s.Circonscription ? s.Circonscription.substring(0, 2) : '', 
        slug: generateSlug(s.Prenom_usuel, s.Nom_usuel),
        biography: `${s.Prenom_usuel} ${s.Nom_usuel} est sénateur (${s.Groupe_politique}) du département : ${s.Circonscription}.`,
        legal_issues: 'Aucune affaire connue'
      };
    });

    console.log('Clearing existing senators...');
    await supabase.from('senators').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    console.log('Inserting new senators...');
    const { error } = await supabase.from('senators').insert(senatorsToInsert);

    if (error) {
      console.error('Error inserting senators:', error);
    } else {
      console.log('Import successful!');
    }
  } catch (error) {
    console.error('Import failed:', error);
  }
}

importSenators();
