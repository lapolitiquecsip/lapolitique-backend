import { supabase } from '../config/supabase';

async function check() {
  console.log('--- Checking Supabase Tables ---');
  
  const tables = ['content', 'pipeline_logs', 'deputies'];
  
  const { data, error } = await supabase.from('deputies').select('*').limit(1);
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Sample Deputy:', JSON.stringify(data[0], null, 2));
  }
}

check();
