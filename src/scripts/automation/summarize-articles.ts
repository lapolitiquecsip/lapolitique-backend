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

async function main() {
    console.log('--- START ARTICLE SUMMARIZATION ---');

    const { data: articles, error } = await supabase
        .from('scrutins')
        .select('id, objet, summary')
        .ilike('objet', "%l'article%")
        .is('summary', null)
        .order('date_scrutin', { ascending: false })
        .limit(20);

    if (error) {
        console.error('Error fetching articles:', error);
        return;
    }

    console.log(`Found ${articles.length} articles to summarize.`);

    for (const article of articles) {
        console.log(`\nProcessing: ${article.objet}`);
        
        try {
            const response = await resilientDeepSeek.createMessage({
                model: 'deepseek-v4-flash',
                max_tokens: 300,
                messages: [
                    {
                        role: 'user',
                        content: `Tu es un expert juridique. Voici l'objet d'un vote à l'Assemblée Nationale :
"${article.objet}"

D'après tes connaissances sur les projets de loi récents français, en quoi consistait spécifiquement cet article ? 
Réponds EN UNE SEULE PHRASE (maximum 15-20 mots), de manière neutre et claire pour un citoyen.
Si tu n'es pas sûr à 100% de la loi en question ou du contenu de cet article, réponds EXACTEMENT : "Détail technique du texte non disponible."

Réponse :`
                    }
                ],
            });

            const content = response.content[0];
            const raw = content.type === 'text' ? content.text.trim().replace(/^"/, '').replace(/"$/, '') : '';

            // Garde-fou : le modèle refuse parfois (« je ne peux pas… », « contenu non fourni… »)
            // au lieu de la phrase de repli demandée. On normalise TOUT refus/placeholder vers le
            // repli neutre, pour ne jamais afficher un « je ne peux pas » au citoyen.
            const REFUSAL = /(n'?a pas été fourni|je ne peux pas|impossible|fournir (le|un) (texte|contenu|résumé)|contenu (complet|spécifique)|veuillez fournir|pas (sûr|certain))/i;
            const summary = (!raw || raw.length < 8 || REFUSAL.test(raw))
              ? "Détail technique du texte non disponible."
              : raw;

            console.log(`=> Summary: ${summary}`);

            const { error: uError } = await supabase
                .from('scrutins')
                .update({ summary })
                .eq('id', article.id);

            if (uError) {
                console.error(`Error updating ${article.id}:`, uError);
            }

        } catch (e: any) {
            console.error(`DeepSeek API Error:`, e.message);
        }
    }

    console.log('--- END ARTICLE SUMMARIZATION ---');
}

main().catch(console.error);
