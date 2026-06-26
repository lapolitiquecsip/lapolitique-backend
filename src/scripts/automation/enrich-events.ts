
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { resilientDeepSeek } from '../../lib/deepseek-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function enrichEvent(title: string, description: string) {
  const content = `Titre original: ${title}\nDescription: ${description}`;

  try {
    const response = await resilientDeepSeek.createMessage({
      model: 'deepseek-v4-flash',
      max_tokens: 400,
      system: `Tu es un journaliste politique expert qui traduit des événements parlementaires arides en informations utiles pour les citoyens.

RÈGLES :
1. "short_title" (max 9 mots) : reformule pour que le lecteur comprenne IMMÉDIATEMENT l'enjeu. Pas un copier-coller du titre original.
   - Si c'est un examen de loi : dis ce que la loi veut faire ("La loi veut encadrer les loyers Airbnb")
   - Si c'est une audition : dis qui et pourquoi ("Le ministre de l'Éco auditionné sur la dette")
   - Si c'est un rapport : dis ce que le rapport révèle, pas juste qu'il existe
   - Si c'est une séance : résume le sujet principal

2. "short_summary" (1-2 phrases, 30 mots max) : quel est l'enjeu concret pour le citoyen ? Si le titre mentionne un chiffre, l'utiliser. Rédiger en français direct, sans jargon.

Réponds UNIQUEMENT au format JSON :
{
  "short_title": "...",
  "short_summary": "..."
}`,
      messages: [
        { role: 'user', content: `Simplifie cet événement parlementaire :\n${content}` }
      ],
    });

    let text = response.content[0].text;

    if (text.includes('```')) {
      text = text.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
    }

    return JSON.parse(text);
  } catch (error) {
    console.error("Erreur DeepSeek:", error);
    return null;
  }
}

async function start() {
  // Enrich events for the next 5 days (includes today + upcoming agenda items)
  const today = new Date();
  const in5Days = new Date(today);
  in5Days.setDate(today.getDate() + 5);

  const fromDate = today.toLocaleDateString('en-CA');
  const toDate = in5Days.toLocaleDateString('en-CA');

  console.log(`Enrichissement des événements du ${fromDate} au ${toDate}...`);

  const { data: events, error } = await supabase
    .from('events')
    .select('*')
    .gte('date', fromDate)
    .lte('date', toDate)
    .is('short_summary', null);

  if (error) {
    console.error("Erreur Supabase:", error);
    return;
  }

  console.log(`${events?.length || 0} événements à traiter.`);

  if (!events || events.length === 0) return;

  for (const event of events) {
    console.log(`Traitement de : ${event.title?.substring(0, 60)}...`);
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

    // Small delay to respect API rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  console.log("Enrichissement terminé !");
}

start();
