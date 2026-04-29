
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

async function enrichEvent(title: string, description: string) {
  const content = `Titre original: ${title}\nDescription: ${description}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: `Tu es un assistant expert en politique française. Ta mission est de transformer des événements parlementaires complexes en informations simples pour le grand public.

RÈGLES CRITIQUES :
1. Titre Court (short_title) : Maximum 8 mots. Très percutant. 
   - SI le titre original est "Suite de l'ordre du jour" ou similaire, analyse la description pour trouver le VRAI sujet (ex: "Suite de l'examen de la loi agricole").
2. Résumé (short_summary) : Une seule phrase, maximum 20 mots. Doit expliquer l'enjeu principal simplement.

Réponds UNIQUEMENT au format JSON suivant :
{
  "short_title": "...",
  "short_summary": "..."
}`,
      messages: [
        { role: "user", content: `Simplifie cet événement :\n${content}` }
      ],
    });

    let text = (response.content[0] as any).text;
    
    // Nettoyage si Claude met des blocs markdown
    if (text.includes('```')) {
      text = text.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
    }
    
    return JSON.parse(text);
  } catch (error) {
    console.error("Erreur Claude:", error);
    return null;
  }
}

async function start() {
  const today = new Date().toLocaleDateString('en-CA');
  console.log(`Enrichissement des événements pour ${today}...`);

  const { data: events, error } = await supabase
    .from('events')
    .select('*')
    .eq('date', today)
    .is('short_summary', null); // On traite ceux qui n'ont pas encore de résumé

  if (error) {
    console.error("Erreur Supabase:", error);
    return;
  }

  console.log(`${events?.length || 0} événements à traiter.`);

  if (!events) return;

  for (const event of events) {
    console.log(`Traitement de : ${event.title.substring(0, 50)}...`);
    const enrichment = await enrichEvent(event.title, event.description);
    
    if (enrichment) {
      const { error: updateError } = await supabase
        .from('events')
        .update({
          short_title: enrichment.short_title,
          short_summary: enrichment.short_summary
        })
        .eq('id', event.id);

      if (updateError) console.error("Erreur update:", updateError);
      else console.log(`✅ ${enrichment.short_title}`);
    }

    // Petit délai pour l'API
    await new Promise(r => setTimeout(r, 500));
  }

  console.log("Enrichissement terminé !");
}

start();
