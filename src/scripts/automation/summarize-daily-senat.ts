import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
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

function generateDeterministicUUID(input: string): string {
  const hash = crypto.createHash('sha1').update(input).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function main() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`--- SUMMARIZING SENAT AGENDA FOR ${today} ---`);

  // 1. Fetch today's events for Sénat
  const { data: events, error: fetchError } = await supabase
    .from('events')
    .select('title, description')
    .eq('institution', 'Sénat')
    .eq('date', today)
    .neq('category', 'DailySummary');

  if (fetchError) {
    console.error('Error fetching events:', fetchError);
    return;
  }

  if (!events || events.length === 0) {
    console.log('No events found for today. Skipping summary.');
    return;
  }

  console.log(`> Found ${events.length} events. Preparing summary...`);

  // 2. Format events for Claude
  const eventsList = events.map(e => `- ${e.title}\n  ${e.description}`).join('\n\n');

  try {
    // 3. Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `Voici l'ordre du jour du Sénat français pour aujourd'hui (${today}). 
          Résume les points clés de manière factuelle et ultra-concise.
          Fais un paragraphe de MAXIMUM 2 phrases courtes. 
          Sois percutant, va droit à l'essentiel.
          
          Ordre du jour :
          ${eventsList}`
        }
      ],
    });

    const summary = response.content[0].type === 'text' ? response.content[0].text : '';

    if (!summary) throw new Error('Claude returned an empty summary');

    console.log('\nGenerated Summary:\n', summary);

    // 4. Save as a special event
    const summaryEvent = {
      id: generateDeterministicUUID(`summary-senat-${today}`),
      date: today,
      title: 'Résumé du jour',
      description: summary,
      institution: 'Sénat',
      category: 'DailySummary',
      short_title: 'Résumé du jour',
      short_summary: summary
    };

    const { error: upsertError } = await supabase
      .from('events')
      .upsert(summaryEvent, { onConflict: 'id' });

    if (upsertError) throw upsertError;

    console.log(`\n✅ Daily summary for Sénat saved successfully!`);

  } catch (error: any) {
    console.error('Error during summarization:', error.message);
  }
}

main();
