
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { logStart, logSuccess, logError } from '../../lib/monitoring.js';
import { resilientAnthropic } from '../../lib/anthropic-client.js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export async function summarizeScrutins() {
  const hcId = process.env.HEALTHCHECK_ID_SUMMARIZER;
  await logStart('summarizeScrutins', hcId);

  let summarizedCount = 0;

  try {
    // Fetch scrutins without summary (strictly empty to respect user's "don't change already done" wish)
    const { data: scrutins, error } = await supabase
      .from('scrutins')
      .select('id, objet')
      .in('type', ['LOI']) // Focus on Laws as requested
      .is('summary', null)
      .order('date_scrutin', { ascending: false })
      .limit(20); // Increased limit for industrialization

    if (error) {
      throw error;
    }

    console.log(`> Found ${scrutins.length} laws to summarize.`);

    for (const s of scrutins) {
      try {
        console.log(`Processing: ${s.objet}`);

        // Models available in 2026 - Optimized for this environment
        const CLAUDE_MODELS = [
          'claude-sonnet-4-6',
          'claude-sonnet-4-6',
          'claude-opus-4-20250514'
        ];

        let success = false;
        for (const model of CLAUDE_MODELS) {
          try {
            const response = await resilientAnthropic.createMessage({
              model: model,
              max_tokens: 1000,
              messages: [
                {
                  role: 'user',
                  content: `Résume cette loi de l'Assemblée Nationale pour un citoyen.
                  Sois simple, neutre et pédagogique.
                  
                  Loi : ${s.objet}
                  
                  Réponds au format JSON STRICT :
                  {
                    "summary": "Résumé en 2-3 phrases",
                    "why_it_matters": "Pourquoi c'est important pour le citoyen",
                    "detailed_summary": "Un résumé long et exhaustif (mini 4 phrases) des mesures concrètes proposées par la loi. INCLUS OBLIGATOIREMENT : les budgets prévus, les sommes d'argent exactes, les organismes ou outils créés, et les dates d'application cibles. Pousse le détail au maximum pour une analyse 'premium'.",
                    "category": "Choisir STRICTEMENT parmi: Économie, Social, Santé, Éducation, Environnement, Sécurité"
                  }
                  
                  RENVOIE UNIQUEMENT LE JSON.`
                }
              ],
            });

            const content = response.content[0];
            const responseBody = content.type === 'text' ? content.text : '';
            
            // Robust JSON extraction
            const jsonMatch = responseBody.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON found in response');
            
            const result = JSON.parse(jsonMatch[0]);

            const { error: uError } = await supabase
              .from('scrutins')
              .update({
                summary: result.summary,
                why_it_matters: `${result.why_it_matters}|||DETAILED|||${result.detailed_summary || "Détails supplémentaires non disponibles."}`,
                category: result.category
              })
              .eq('id', s.id);

            if (uError) throw uError;
            
            console.log(`✅ Success for ${s.id} using ${model}`);
            success = true;
            summarizedCount++;
            break; // Next scrutin
          } catch (mErr: any) {
            console.error(`⚠️ Model ${model} failed for ${s.id}: ${mErr.status || mErr.message}`);
            continue; // Try next model
          }
        }

        if (!success) {
          console.error(`❌ All models failed for ${s.id}`);
        }

      } catch (err: any) {
        console.error(`❌ Global error for ${s.id}:`, err.message);
      }
    }

    await logSuccess('summarizeScrutins', summarizedCount, hcId);
    return summarizedCount;

  } catch (err: any) {
    await logError('summarizeScrutins', err, hcId);
    throw err;
  }
}

// Standalone execution support
const nodePath = fs.realpathSync(process.argv[1]);
const currentPath = fileURLToPath(import.meta.url);
if (nodePath === currentPath || nodePath.endsWith('scrutin-summarizer.ts') || nodePath.endsWith('scrutin-summarizer.js')) {
  summarizeScrutins().catch(console.error);
}
