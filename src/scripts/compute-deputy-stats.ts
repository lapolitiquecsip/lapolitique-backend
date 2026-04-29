
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('--- CALCUL DES STATISTIQUES DÉPUTÉS ---');

  // 1. Récupérer tous les députés actifs
  const { data: deputies, error: depError } = await supabase
    .from('deputies')
    .select('id, an_id, party');
  
  if (depError) throw depError;
  console.log(`> ${deputies.length} députés trouvés.`);

  // 2. Récupérer tous les scrutins
  const { data: scrutins, error: scrutError } = await supabase
    .from('scrutins')
    .select('id');
  
  if (scrutError) throw scrutError;
  const totalScrutins = scrutins.length;
  console.log(`> ${totalScrutins} scrutins au total.`);

  if (totalScrutins === 0) {
    console.warn("Aucun scrutin trouvé, calcul impossible.");
    return;
  }

  // 3. Pré-calculer la majorité de chaque groupe pour chaque scrutin (pour la loyauté)
  console.log("> Calcul des majorités de groupe...");
  const { data: allVotes, error: voteError } = await supabase
    .from('deputy_votes')
    .select('scrutin_id, deputy_an_id, position, deputies(party)');
  
  if (voteError) throw voteError;

  const groupMajorities: Record<string, Record<string, string>> = {}; // scrutinId -> group -> position

  // Organiser par scrutin et groupe
  const scrutinGroupVotes: Record<string, Record<string, Record<string, number>>> = {};

  allVotes.forEach((v: any) => {
    const group = (v.deputies as any)?.party;
    if (!group) return;

    if (!scrutinGroupVotes[v.scrutin_id]) scrutinGroupVotes[v.scrutin_id] = {};
    if (!scrutinGroupVotes[v.scrutin_id][group]) scrutinGroupVotes[v.scrutin_id][group] = { 'pour': 0, 'contre': 0, 'abstention': 0 };
    
    scrutinGroupVotes[v.scrutin_id][group][v.position]++;
  });

  // Déterminer la majorité
  Object.keys(scrutinGroupVotes).forEach(sid => {
    groupMajorities[sid] = {};
    Object.keys(scrutinGroupVotes[sid]).forEach(group => {
      const counts = scrutinGroupVotes[sid][group];
      let majority = 'pour';
      if (counts['contre'] > counts[majority]) majority = 'contre';
      if (counts['abstention'] > counts[majority]) majority = 'abstention';
      groupMajorities[sid][group] = majority;
    });
  });

  // 4. Calculer pour chaque député
  console.log("> Mise à jour des députés...");
  let updated = 0;

  for (const dep of deputies) {
    const depVotes = allVotes.filter(v => v.deputy_an_id === dep.an_id);
    const voteCount = depVotes.length;
    
    // Taux de participation
    const participationRate = (voteCount / totalScrutins) * 100;

    // Loyauté au groupe
    let matchingVotes = 0;
    let loyaltyEligible = 0;

    depVotes.forEach(v => {
      const majority = groupMajorities[v.scrutin_id]?.[dep.party];
      if (majority) {
        loyaltyEligible++;
        if (v.position === majority) matchingVotes++;
      }
    });

    const groupLoyalty = loyaltyEligible > 0 ? (matchingVotes / loyaltyEligible) * 100 : 100;

    // Update
    const { error: upError } = await supabase
      .from('deputies')
      .update({
        participation_rate: Math.round(participationRate * 10) / 10,
        group_loyalty: Math.round(groupLoyalty * 10) / 10
      })
      .eq('id', dep.id);

    if (!upError) updated++;
  }

  console.log(`\nTERMINE : ${updated} députés mis à jour avec leurs statistiques.`);
}

main().catch(console.error);
