
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});
console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'Present' : 'MISSING');

async function shortenTitle(longTitle: string): Promise<string> {
  // Clean the title from existing time tags [HH:MM] if any
  const cleanedTitle = longTitle.replace(/^\[\d{2}:\d{2}\]\s*/, '').replace(/^-+\s*/, '').trim();
  
  if (cleanedTitle.length < 30) return cleanedTitle; // Already short enough

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      system: "Tu es un assistant expert en politique française. Ta mission est de raccourcir des titres d'événements parlementaires complexes en titres simples, clairs et percutants (max 10 mots). Réponds uniquement par le nouveau titre, sans ponctuation inutile au début.",
      messages: [
        {
          role: "user",
          content: `Raccourcis ce titre : "${cleanedTitle}"`
        }
      ]
    });

    const content = response.content[0];
    if (content && content.type === 'text') {
      return content.text.trim().replace(/^"/, '').replace(/"$/, '');
    }
    return cleanedTitle;
  } catch (error) {
    console.error(`Error shortening title: ${longTitle}`, error);
    return cleanedTitle;
  }
}

async function main() {
  console.log('--- ENRICH EVENTS WITH AI TITLES ---');

  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  // Fetch all events that don't have a short_title
  const { data: events, error } = await supabase
    .from('events')
    .select('id, title, short_title');

  if (error) {
    console.error('Error fetching events:', error);
    return;
  }

  // Filter in JS to be safe
  const toEnrich = events?.filter(e => !e.short_title || e.short_title.trim() === '') || [];

  if (toEnrich.length === 0) {
    console.log('No events to enrich.');
    return;
  }

  console.log(`Processing ${toEnrich.length} events...`);

  for (const event of toEnrich) {
    console.log(`Shortening: ${event.title.substring(0, 50)}...`);
    const shortTitle = await shortenTitle(event.title);
    console.log(`Result: ${shortTitle}`);

    const { error: updateError } = await supabase
      .from('events')
      .update({ short_title: shortTitle })
      .eq('id', event.id);

    if (updateError) {
      console.error(`Error updating event ${event.id}:`, updateError);
    }
  }

  console.log('Enrichment complete.');
}

main().catch(console.error);
