import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

async function summarizeLaws() {
  console.log('--- START LAW SUMMARIZATION ---');

  // Fetch laws that have generic summaries
  const { data: laws, error } = await supabase
    .from('laws')
    .select('id, title, summary')
    .ilike('summary', 'Dossier législatif n°%') // Find generic ones
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching laws:', error);
    return;
  }

  console.log(`> Found ${laws.length} laws to summarize.`);

  for (const l of laws) {
    try {
      console.log(`Processing: ${l.title}`);

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
            max_tokens: 1500,
            messages: [
              {
                role: 'user',
                content: `Analyse et résume ce projet/proposition de loi de l'Assemblée Nationale.
                Sois simple, neutre et pédagogique.
                
                Loi : ${l.title}
                
                Réponds au format JSON STRICT :
                {
                  "summary": "Résumé en 2-3 phrases",
                  "content": "Un résumé long et exhaustif (mini 5 phrases) des mesures concrètes proposées par la loi. Inclus les impacts directs sur le citoyen, les enjeux budgétaires éventuels, et les objectifs principaux. Pousse le détail au maximum pour une analyse 'premium'.",
                  "category": "Choisir STRICTEMENT parmi: Économie, Social, Santé, Éducation, Environnement, Sécurité"
                }
                
                RENVOIE UNIQUEMENT LE JSON.`
              }
            ],
          });

          const content = response.content[0];
          const responseBody = content.type === 'text' ? content.text : '';
          
          const jsonMatch = responseBody.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('No JSON found in response');
          
          const result = JSON.parse(jsonMatch[0]);

          const { error: uError } = await supabase
            .from('laws')
            .update({
              summary: result.summary,
              content: result.content,
              category: result.category
            })
            .eq('id', l.id);

          if (uError) throw uError;
          
          console.log(`✅ Success for ${l.id} using ${model}`);
          success = true;
          break;
        } catch (mErr: any) {
          console.error(`⚠️ Model ${model} failed for ${l.id}: ${mErr.status || mErr.message}`);
          continue;
        }
      }

      if (!success) {
        console.error(`❌ All models failed for ${l.id}`);
      }

    } catch (err: any) {
      console.error(`❌ Global error for ${l.id}:`, err.message);
    }
  }

  console.log('--- END LAW SUMMARIZATION ---');
}

summarizeLaws();
