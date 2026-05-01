
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ACTOR_DIR = path.join(__dirname, '../../../dep_17_data/json/acteur');

async function getBioData(anId: string) {
  const filePath = path.join(ACTOR_DIR, `${anId}.json`);
  if (!fs.existsSync(filePath)) return null;

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const actor = data.acteur;
  
  return {
    name: `${actor.etatCivil.ident.prenom} ${actor.etatCivil.ident.nom}`,
    birth: `${actor.etatCivil.infoNaissance.villeNais} (${actor.etatCivil.infoNaissance.depNais})`,
    profession: actor.profession.libelleCourant,
    mandates: (Array.isArray(actor.mandats.mandat) ? actor.mandats.mandat : [actor.mandats.mandat])
      .filter((m: any) => m.typeOrgane === 'ASSEMBLEE' || m.typeOrgane === 'GVT')
      .map((m: any) => m.libelleQualite || "Député")
      .slice(0, 3)
  };
}

async function main() {
  // Fetch deputies where biography is short (placeholder)
  const { data: deputies } = await supabase
    .from('deputies')
    .select('id, an_id, slug, biography')
    .limit(20);
  
  if (!deputies || deputies.length === 0) {
    console.log("Aucun député trouvé.");
    return;
  }

  // Filter for placeholders (one sentence about being a deputy)
  const placeholders = deputies.filter(d => 
    !d.biography || d.biography.length < 150 || d.biography.includes("est député de la")
  );

  if (placeholders.length === 0) {
    console.log("Aucun portrait à remplir (tous semblent déjà personnalisés).");
    return;
  }

  const batch = [];
  for (const dep of placeholders) {
    const bio = await getBioData(dep.an_id);
    if (bio) {
        batch.push({ id: dep.id, slug: dep.slug, ...bio });
    }
  }

  console.log(`> ${batch.length} biographies extraites.`);
  fs.writeFileSync('portraits_data.json', JSON.stringify(batch, null, 2));
  console.log("Fichier portraits_data.json créé.");
}

main().catch(console.error);
