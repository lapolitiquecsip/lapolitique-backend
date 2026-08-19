import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function parseCSV(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let insideQuote = false;
  let entry = '';
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i+1];
    
    if (char === '"') {
      if (insideQuote && nextChar === '"') {
        entry += '"';
        i++;
      } else {
        insideQuote = !insideQuote;
      }
    } else if (char === ',' && !insideQuote) {
      row.push(entry.trim());
      entry = '';
    } else if ((char === '\r' || char === '\n') && !insideQuote) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      row.push(entry.trim());
      result.push(row);
      row = [];
      entry = '';
    } else {
      entry += char;
    }
  }
  if (entry || row.length > 0) {
    row.push(entry.trim());
    result.push(row);
  }
  return result;
}

export async function syncDeputyStats() {
  console.log('🚀 Starting Datan Daily Deputy Statistics Synchronization...');
  
  try {
    const url = 'https://www.data.gouv.fr/api/1/datasets/r/092bd7bb-1543-405b-b53c-932ebb49bb8e';
    console.log(`📥 Downloading latest CSV data from: ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error downloading CSV! status: ${response.status}`);
    }
    
    const csvText = await response.text();
    const rows = parseCSV(csvText);
    if (rows.length < 2) {
      throw new Error('CSV is empty or missing header row.');
    }
    
    const headers = rows[0];
    const dataRows = rows.slice(1).filter(r => r.length > 0 && r[0]);
    console.log(`✅ Loaded ${dataRows.length} deputies records from CSV.`);

    // Map headers to column indices
    const headerIndices: Record<string, number> = {};
    headers.forEach((h, idx) => {
      headerIndices[h] = idx;
    });

    console.log('📥 Loading existing deputies from database...');
    const { data: dbDeputies, error: dbError } = await supabase
      .from('deputies')
      .select('id, an_id, first_name, last_name');
      
    if (dbError) throw dbError;
    console.log(`✅ Loaded ${dbDeputies?.length || 0} deputies from database.`);

    const deputyMapByAnId = new Map<string, any>();
    dbDeputies?.forEach(d => {
      if (d.an_id) {
        deputyMapByAnId.set(d.an_id.trim(), d);
      }
    });

    let updatedCount = 0;
    let missingCount = 0;
    const sittingIds = new Set<string>();   // députés présents dans le roster officiel (en fonction)

    for (const row of dataRows) {
      const getValue = (header: string): string => {
        const idx = headerIndices[header];
        return idx !== undefined ? row[idx] || '' : '';
      };

      const anId = getValue('id').trim();
      if (!anId) continue;

      const dbDeputy = deputyMapByAnId.get(anId);
      if (!dbDeputy) {
        missingCount++;
        continue;
      }
      sittingIds.add(dbDeputy.id);   // présent dans le roster AN → en fonction

      // Safe number parsers
      const parsePercent = (val: string): number | null => {
        const num = parseFloat(val);
        return isNaN(num) ? null : Math.round(num * 1000) / 10; // convert 0.913 to 91.3
      };

      const parseNumber = (val: string): number | null => {
        const num = parseInt(val, 10);
        return isNaN(num) ? null : num;
      };

      const payload: Record<string, any> = {
        participation_rate: parsePercent(getValue('scoreParticipation')),
        group_loyalty: parsePercent(getValue('scoreLoyaute')),
        nombre_mandats: parseNumber(getValue('nombreMandats')),
        experience_depute: getValue('experienceDepute') || null,
        score_participation_specialite: parsePercent(getValue('scoreParticipationSpecialite')),
        score_majorite: parsePercent(getValue('scoreMajorite')),
        date_maj: getValue('dateMaj') || new Date().toISOString().split('T')[0],
        date_prise_fonction: getValue('datePriseFonction') || null,
        job: getValue('job') || null,
        mail: getValue('mail') || null,
        twitter: getValue('twitter') || null,
        facebook: getValue('facebook') || null,
        website: getValue('website') || null
      };

      let updateError;
      
      // Try updating all columns (including new ones)
      const { error: fullUpdateError } = await supabase
        .from('deputies')
        .update(payload)
        .eq('id', dbDeputy.id);
        
      if (fullUpdateError) {
        updateError = fullUpdateError;
        
        // If the error is due to missing columns (Postgres code '42703' or message refers to missing column/schema cache)
        const isMissingColumnError = 
          fullUpdateError.code === '42703' || 
          fullUpdateError.message?.includes('column') || 
          fullUpdateError.message?.includes('schema cache');
          
        if (isMissingColumnError) {
          // Output this warning once or periodically to not spam logs too much
          if (updatedCount === 0) {
            console.warn(`\n⚠️ WARNING: The new stats columns do not exist yet in the database.`);
            console.warn(`👉 Please run the migration 'supabase/migrations/20260630_add_datan_deputy_stats.sql' in the Supabase SQL editor to enable all stats.`);
            console.warn(`👉 Attempting to update only the existing columns (participation_rate and group_loyalty) as fallback...\n`);
          }
          
          const fallbackPayload = {
            participation_rate: payload.participation_rate,
            group_loyalty: payload.group_loyalty
          };
          
          const { error: fallbackError } = await supabase
            .from('deputies')
            .update(fallbackPayload)
            .eq('id', dbDeputy.id);
            
          updateError = fallbackError;
        }
      }

      if (updateError) {
        console.error(`❌ Failed to update stats for ${dbDeputy.first_name} ${dbDeputy.last_name}:`, updateError.message);
      } else {
        updatedCount++;
      }
    }

    // NB : on NE déduit PAS le statut « en fonction » de ce CSV datan — il n'est pas un roster
    // exhaustif (des députés en fonction en sont absents → faux positifs). La détection des départs
    // députés nécessite la source AUTORITAIRE de l'AN (acteurs/mandats avec dateFin), à part.
    void sittingIds;

    console.log(`\n=== SYNCHRONIZATION COMPLETED ===`);
    console.log(`Updated deputies: ${updatedCount}`);
    console.log(`Deputies missing in DB: ${missingCount}`);
    console.log(`=================================`);

  } catch (err: any) {
    console.error('❌ Error during synchronization:', err);
    if (err.cause) console.error('Cause:', err.cause);
  }
}

// Run immediately if executed directly
if (process.argv[1]?.includes('fetch-deputy-stats')) {
  syncDeputyStats();
}
