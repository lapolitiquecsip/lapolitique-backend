
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

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const actor = data.acteur;
    
    return {
      name: `${actor.etatCivil.ident.prenom} ${actor.etatCivil.ident.nom}`,
      birth: `${actor.etatCivil.infoNaissance.villeNais} (${actor.etatCivil.infoNaissance.depNais})`,
      profession: actor.profession.libelleCourant,
      mandates: (Array.isArray(actor.mandats.mandat) ? actor.mandats.mandat : [actor.mandats.mandat])
        .filter((m: any) => m.typeOrgane === 'ASSEMBLEE' || m.typeOrgane === 'GVT')
        .map((m: any) => m.libelleQualite || "Député")
        .slice(0, 2)
    };
  } catch (e) {
    return null;
  }
}

async function main() {
  const { data: deputies } = await supabase
    .from('deputies')
    .select('id, an_id, slug, biography')
    .order('slug')
    .limit(600);
  
  if (!deputies) return;

  const toProcess = deputies.filter(d => 
    !d.biography || d.biography.length < 150 || d.biography.includes("est député de la")
  );

  const batch = [];
  for (const dep of toProcess) {
    const bio = await getBioData(dep.an_id);
    if (bio) {
        batch.push({ id: dep.id, slug: dep.slug, ...bio });
    }
  }

  fs.writeFileSync('next_batch_data.json', JSON.stringify(batch, null, 2));
  console.log(`> ${batch.length} députés prêts pour la rédaction.`);
}

main().catch(console.error);
