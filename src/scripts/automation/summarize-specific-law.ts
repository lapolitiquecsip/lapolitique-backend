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

async function main() {
  console.log('--- START TARGETED RE-SUMMARIZATION ---');

  const { data: scrutins, error } = await supabase
    .from('scrutins')
    .select('id, objet')
    .ilike('objet', "%patrimoine immobilier%")
    .limit(5);

  if (error || !scrutins || scrutins.length === 0) {
    console.error('Error fetching scrutin:', error);
    return;
  }

  for (const s of scrutins) {
      console.log(`Processing: ${s.objet}`);

      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
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
                "detailed_summary": "Un résumé long et exhaustif (mini 4 phrases) des mesures concrètes proposées par la loi.",
                "category": "Choisir parmi: Économie, Social, Santé, Éducation, Environnement, Sécurité, Justice, Institutions, International, Culture"
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
          .from('scrutins')
          .update({
            summary: result.summary,
            why_it_matters: `${result.why_it_matters}|||DETAILED|||${result.detailed_summary || "Détails supplémentaires non disponibles."}`,
            category: result.category
          })
          .eq('id', s.id);

        if (uError) throw uError;
        
        console.log(`✅ Success for ${s.id}`);
      } catch (e: any) {
        console.error(`Error:`, e.message);
      }
  }

  console.log('--- END ---');
}

main();
