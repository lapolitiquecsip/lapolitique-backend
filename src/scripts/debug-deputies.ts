import { supabase } from '../config/supabase.js';

async function debug() {
  const { data: deputies, error } = await supabase.from('deputies').select('id, first_name, last_name, party');
  if (error) {
    console.error('Error fetching deputies:', error);
    return;
  }

  console.log(`Total deputies: ${deputies.length}`);

  const counts: Record<string, number> = {};
  deputies.forEach(d => {
    const key = `${d.first_name} ${d.last_name}`;
    counts[key] = (counts[key] || 0) + 1;
  });

  const duplicates = Object.entries(counts).filter(([_, count]) => count > 1);
  console.log('Duplicates found:', duplicates.length);
  if (duplicates.length > 0) {
    console.log('Sample duplicates:', duplicates.slice(0, 5));
  }

  // Check if some are from old legis? 
  // We don't have legislature field in the DB schema I saw, but we have an_id.
}

debug();
