
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

async function summarizeScrutins() {
  console.log('--- START SCRUTIN SUMMARIZATION ---');

  // Fetch scrutins without summary (strictly empty to respect user's "don't change already done" wish)
  const { data: scrutins, error } = await supabase
    .from('scrutins')
    .select('id, objet')
    .in('type', ['LOI', 'ARTICLE'])
    .is('summary', null)
    .order('date_scrutin', { ascending: false })
    .limit(500);

  if (error) {
    console.error('Error fetching scrutins:', error);
    return;
  }

  console.log(`> Found ${scrutins.length} laws to summarize.`);

  for (const s of scrutins) {
    try {
      console.log(`Processing: ${s.objet}`);

      // Models available in 2026 - Optimized for this environment
      const CLAUDE_MODELS = [
        'claude-sonnet-4-20250514',
        'claude-sonnet-4-6',
        'claude-opus-4-20250514'
      ];

      let success = false;
      for (const model of CLAUDE_MODELS) {
        try {
          const response = await anthropic.messages.create({
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
                  "category": "Choisir parmi: Économie, Social, Santé, Éducation, Environnement, Sécurité, Justice, Institutions, International, Culture"
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

  console.log('--- END SCRUTIN SUMMARIZATION ---');
}

summarizeScrutins();
