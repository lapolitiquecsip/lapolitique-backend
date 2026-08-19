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
    const toInsert: string[][] = [];         // députés du roster ABSENTS de la base (nouveaux : suppléants…)

    const gv = (row: string[], header: string): string => {
      const idx = headerIndices[header];
      return idx !== undefined ? (row[idx] || '') : '';
    };

    for (const row of dataRows) {
      const getValue = (header: string): string => gv(row, header);

      const anId = getValue('id').trim();
      if (!anId) continue;

      const dbDeputy = deputyMapByAnId.get(anId);
      if (!dbDeputy) {
        missingCount++;
        if (anId.startsWith('PA')) toInsert.push(row);   // à créer
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

    // NB : on NE déduit PAS le statut « en fonction » de ce CSV (fait par sync-deputy-roster, source AN).
    void sittingIds;

    // Insère les députés du roster ABSENTS de la base (nouveaux entrants : suppléants des sortis…),
    // pour garder le roster complet automatiquement. Champs officiels tirés du CSV datan.
    if (toInsert.length > 0) {
      const GROUP_COLOR: Record<string, string> = {
        LFI: '#E4032E', GDR: '#D40000', ECO: '#4CA85F', SOC: '#E24E8B', LIOT: '#F2C037',
        DEM: '#FF9900', EPR: '#7B2C8F', HOR: '#5BC0EB', DR: '#2E5AAC', UDR: '#0B3D91', NI: '#8D949A',
      };
      const slugify = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const pct = (v: string) => { const n = parseFloat(v); return isNaN(n) ? null : Math.round(n * 1000) / 10; };
      const num = (v: string) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
      const { data: existing } = await supabase.from('deputies').select('slug');
      const slugs = new Set((existing || []).map((d: any) => d.slug));
      const records = toInsert.map(row => {
        const anId = gv(row, 'id').trim();
        const prenom = gv(row, 'prenom').trim(), nom = gv(row, 'nom').trim();
        let slug = slugify(`${prenom} ${nom}`);
        if (slugs.has(slug)) slug = `${slug}-${anId.replace('PA', '')}`;   // désambiguïse (homonyme)
        slugs.add(slug);
        const abbr = gv(row, 'groupeAbrev').trim();
        return {
          an_id: anId, first_name: prenom, last_name: nom, slug,
          party: abbr || gv(row, 'groupe').trim() || null,
          party_color: GROUP_COLOR[abbr] || null,
          department: gv(row, 'departementNom').trim() || null,
          constituency_number: num(gv(row, 'circo')),
          photo_url: `https://www.assemblee-nationale.fr/dyn/static/tribun/17/photos/carre/${anId.replace('PA', '')}.jpg`,
          participation_rate: pct(gv(row, 'scoreParticipation')),
          group_loyalty: pct(gv(row, 'scoreLoyaute')),
          nombre_mandats: num(gv(row, 'nombreMandats')),
          date_prise_fonction: gv(row, 'datePriseFonction').trim() || null,
          job: gv(row, 'job').trim() || null,
          sitting: true,
        };
      });
      const { error: insErr } = await supabase.from('deputies').insert(records);
      if (insErr) console.warn(`⚠️ insertion nouveaux députés : ${insErr.message}`);
      else console.log(`> ${records.length} nouveau(x) député(s) ajouté(s) au roster.`);
    }

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
