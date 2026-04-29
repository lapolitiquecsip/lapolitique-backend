
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

const ACTOR_DIR = path.join(__dirname, '../../dep_17_data/json/acteur');

async function main() {
  console.log('--- ENRICHISSEMENT HISTORIQUE POLITIQUE ---');

  const { data: deputies, error: depError } = await supabase
    .from('deputies')
    .select('id, an_id');
  
  if (depError) throw depError;
  console.log(`> ${deputies.length} députés à traiter.`);

  let updated = 0;

  for (const dep of deputies) {
    const filePath = path.join(ACTOR_DIR, `${dep.an_id}.json`);
    if (!fs.existsSync(filePath)) continue;

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const actor = data.acteur;
      
      const mandats = Array.isArray(actor.mandats.mandat) ? actor.mandats.mandat : [actor.mandats.mandat];
      
      const history = mandats
        .filter((m: any) => m.dateDebut) // On ne garde que les mandats avec date
        .map((m: any) => ({
          type: m.typeOrgane,
          label: m.libelleQualite || m.infosQualite?.libQualite || "Membre",
          startDate: m.dateDebut,
          endDate: m.dateFin || null,
          legislature: m.legislature || null,
          organe: m.organes?.organeRef || null
        }))
        .sort((a: any, b: any) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

      const { error: upError } = await supabase
        .from('deputies')
        .update({ political_history: history })
        .eq('id', dep.id);

      if (!upError) updated++;
    } catch (e) {
      console.error(`Erreur pour ${dep.an_id}:`, e);
    }
  }

  console.log(`\nTERMINE : ${updated} historiques politiques injectés.`);
}

main().catch(console.error);
