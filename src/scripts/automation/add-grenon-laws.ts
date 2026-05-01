import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const GRENON_LAWS = [
  {
    title: "Qualifier la soustraction frauduleuse de l'animal domestique de vol aggravé - N° 2373",
    author: "M. Daniel Grenon",
    category: "Proposition de loi",
    summary: "Cette proposition de loi vise à durcir les sanctions pénales en cas de vol d'animaux de compagnie, en le qualifiant de vol aggravé pour mieux protéger les propriétaires et leurs animaux.",
    content: "CONTEXTE :\nLe vol d'animaux domestiques est en forte augmentation et cause un préjudice moral immense aux propriétaires.\n\nMESURES PROPOSÉES :\n- Qualification du vol d'animal comme vol aggravé dans le Code pénal.\n- Augmentation des peines d'emprisonnement et des amendes encourues.\n- Renforcement des moyens de recherche et d'identification.",
    timeline: "Dépôt du texte",
    source_urls: ["https://www.assemblee-nationale.fr/dyn/17/dossiers/soustraction_frauduleuse_animal_domestique"],
    context: "[2026-01-21] Dossier n°2373"
  },
  {
    title: "Reconnaître et protéger la crèche de Noël en tant qu'élément du patrimoine culturel immatériel français - N° 2272",
    author: "M. Daniel Grenon",
    category: "Proposition de loi",
    summary: "Ce texte propose de sécuriser juridiquement l'installation de crèches de Noël dans l'espace public en les reconnaissant comme une tradition culturelle et non un simple symbole religieux.",
    content: "CONTEXTE :\nLes polémiques récurrentes sur l'installation de crèches dans les mairies créent une insécurité juridique pour les élus locaux.\n\nMESURES PROPOSÉES :\n- Inscription de la crèche de Noël au patrimoine culturel immatériel de la France.\n- Autorisation explicite de leur installation dans les bâtiments publics au titre de la tradition culturelle.",
    timeline: "Dépôt du texte",
    source_urls: ["https://www.assemblee-nationale.fr/dyn/17/dossiers/protection_creche_noel"],
    context: "[2025-12-18] Dossier n°2272"
  }
];

async function run() {
  for (const law of GRENON_LAWS) {
    const { error } = await supabase.from('laws').insert([law]);
    if (error) console.error(`Error inserting law:`, error);
    else console.log(`✅ Law inserted`);
  }
}

run();
