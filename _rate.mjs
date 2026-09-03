import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const s=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
// analyses générées par jour (7 derniers jours)
const {data}=await s.from('legislative_analyses').select('generated_at').gte('generated_at',new Date(Date.now()-8*864e5).toISOString());
const byDay={};
for(const r of (data||[])){const d=(r.generated_at||'').slice(0,10);byDay[d]=(byDay[d]||0)+1;}
console.log('Analyses générées / jour (7j) :');
for(const [d,n] of Object.entries(byDay).sort()) console.log('  ',d,n);
const {data:last}=await s.from('legislative_analyses').select('generated_at').order('generated_at',{ascending:false}).limit(1);
console.log('Dernière analyse générée:',last?.[0]?.generated_at);
