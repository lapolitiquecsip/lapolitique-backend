
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

async function summarizeScrutins() {
  console.log('--- START SCRUTIN SUMMARIZATION ---');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY is missing in .env');
    return;
  }

  // Fetch scrutins without summary
  const { data: scrutins, error } = await supabase
    .from('scrutins')
    .select('id, objet, type')
    .eq('type', 'LOI')
    .is('summary', null)
    .order('date_scrutin', { ascending: false })
    .limit(100); // Process in small batches

  if (error) {
    console.error('Error fetching scrutins:', error.message);
    return;
  }

  console.log(`> Found ${scrutins.length} laws to summarize.`);

  for (const s of scrutins) {
    try {
      console.log(`Processing: ${s.objet}`);

      let response;
      const models = ['claude-3-5-sonnet-latest', 'claude-3-5-sonnet-20240620', 'claude-3-haiku-20240307'];
      
      for (const model of models) {
        try {
          response = await anthropic.messages.create({
            model: model,
            max_tokens: 1000,
            messages: [{
              role: 'user',
              content: `Tu es un expert en politique française. Résume l'enjeu de ce scrutin parlementaire pour un citoyen non-expert. 
              Sois très concis (2 phrases max). 
              Explique aussi brièvement "L'enjeu" (pourquoi c'est important).
              
              Titre du scrutin : "${s.objet}"
              
              Réponds au format JSON strict :
              {
                "summary": "Résumé vulgarisé ici...",
                "why_it_matters": "Enjeu principal ici..."
              }`
            }]
          });
          console.log(`✅ Success with model ${model}`);
          break;
        } catch (mErr: any) {
          console.error(`⚠️ Model ${model} failed: ${mErr.status}`);
          if (model === models[models.length - 1]) throw mErr;
        }
      }

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const result = JSON.parse(text);

      const { error: uError } = await supabase
        .from('scrutins')
        .update({
          summary: result.summary,
          why_it_matters: result.why_it_matters
        })
        .eq('id', s.id);

      if (uError) throw uError;
      console.log(`✅ Summarized ${s.id}`);

    } catch (err: any) {
      console.error(`❌ Failed to summarize ${s.id}:`, err.message);
    }
  }

  console.log('--- SUMMARIZATION COMPLETED ---');
}

summarizeScrutins();
