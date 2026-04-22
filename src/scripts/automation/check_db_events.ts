import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkEvents() {
  console.log('--- CHECKING EVENTS IN DB ---');
  
  // Total count
  const { count, error: countError } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true });
    
  if (countError) {
    console.error('Error counting events:', countError);
    return;
  }
  console.log(`Total events: ${count}`);

  // Sample events for April 2026
  const { data: aprilEvents, error: aprilError } = await supabase
    .from('events')
    .select('*')
    .gte('date', '2026-04-01')
    .lte('date', '2026-04-30')
    .limit(10);

  if (aprilError) {
    console.error('Error fetching April events:', aprilError);
  } else {
    console.log(`Events in April 2026: ${aprilEvents?.length || 0}`);
    if (aprilEvents && aprilEvents.length > 0) {
      console.log('Sample event:', JSON.stringify(aprilEvents[0], null, 2));
    }
  }

  // Count by institution
  const institutions = ['Assemblée nationale', 'Sénat', 'Élysée'];
  for (const inst of institutions) {
    const { count: instCount } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('institution', inst);
    console.log(`${inst}: ${instCount}`);
  }
}

checkEvents();
