import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { resilientDeepSeek } from '../../lib/deepseek-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function summarizeLaws() {
  console.log('--- START LAW SUMMARIZATION ---');

  const limit = parseInt(process.env.SUMMARIZE_LIMIT || '50', 10);
  console.log(`> Using limit: ${limit}`);

  // Fetch laws that have generic summaries from the 17th legislature
  const { data: laws, error } = await supabase
    .from('laws')
    .select('id, title, summary')
    .ilike('summary', 'Dossier législatif n°DLR5L17%') // Find generic ones of current leg
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching laws:', error);
    return;
  }

  console.log(`> Found ${laws.length} laws to summarize.`);

  for (const l of laws) {
    try {
      console.log(`Processing: ${l.title}`);

      // Try deepseek-v4-flash first, fall back to deepseek-v4-pro
      const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'];

      let success = false;
      for (const model of DEEPSEEK_MODELS) {
        try {
          const response = await resilientDeepSeek.createMessage({
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
