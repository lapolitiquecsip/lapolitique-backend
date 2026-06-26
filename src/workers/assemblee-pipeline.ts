import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { supabase } from '../config/supabase.js';
import * as Sentry from '@sentry/node';
import { logStart, logSuccess, logError } from '../lib/monitoring.js';
import { resilientDeepSeek } from '../lib/deepseek-client.js';

const parser = new Parser();

export async function runAssembleePipeline() {
  console.log(`[AssembleePipeline] Starting run at ${new Date().toISOString()}`);
  const hcId = process.env.HEALTHCHECK_ID_ASSEMBLEE;
  await logStart('assembleePipeline', hcId);

  let itemsProcessed = 0;
  let itemsErrors = 0;

  try {
    const feed = await parser.parseURL('https://www.assemblee-nationale.fr/dyn/rss/comptes-rendus.rss');
    
    for (const item of feed.items) {
      try {
        const sourceUrl = item.link;
        if (!sourceUrl) continue;

        // 1. Deduplication
        const { data: existing } = await supabase
          .from('content')
          .select('id')
          .eq('source_url', sourceUrl)
          .single();

        if (existing) {
          console.log(`[AssembleePipeline] Skipping existing item: ${sourceUrl}`);
          continue;
        }

        console.log(`[AssembleePipeline] Processing new item: ${sourceUrl}`);

        // 2. Fetch HTML content
        const res = await fetch(sourceUrl);
        const html = await res.text();

        // 3. Extract text using Cheerio
        const $ = cheerio.load(html);
        $("script, style, nav, footer, header, aside, .sidebar").remove();
        
        // Assemblée often uses .central-content or #main or plain main
        const mainContent = $('main').length ? $('main').text() : $('body').text();
        const cleanedText = mainContent.replace(/\s+/g, ' ').trim();

        if (cleanedText.length < 500) {
          console.log(`[AssembleePipeline] Content too short for ${sourceUrl}, skipping.`);
          continue;
        }

        // 4. Send to DeepSeek
        const response = await resilientDeepSeek.createMessage({
          model: 'deepseek-v4-flash',
          max_tokens: 1200,
          system: `Tu es un journaliste politique expert qui alimente un fil d'actu addictif pour des citoyens français curieux.

TON OBJECTIF : chaque carte doit apprendre quelque chose de CONCRET à l'utilisateur. Pas de vague, pas de généralités.

RÈGLES ABSOLUES :
1. "titre_simplifie" (max 12 mots) : accrocheur, factuel. Commence par un chiffre, une conséquence concrète, ou une question qui interpelle. JAMAIS juste "Rapport X publié" ou "Examen du projet Y".
   Exemples BONS : "Les retraites anticipées coûtent 3,8 Mds€ par an" / "Loyers parisiens : +7% en 2025, pourquoi ?" / "La loi agricole supprime 12 000 contrôles par an"
   Exemples MAUVAIS : "Publication du rapport Bruneau" / "Examen de la loi de finances" / "Suite de l'ordre du jour"

2. "resume_flash" (2-3 phrases, 60 mots max) : TOUJOURS inclure au moins 1 chiffre ou fait concret extrait du texte (budget en euros, nombre de personnes, pourcentage, délai...). Expliquer l'impact réel sur les citoyens. Rédiger comme un journaliste de terrain.

3. "resume_detaille" (6-10 phrases) : contexte complet, enjeux, chiffres clés, positions politiques, conséquences pratiques pour les Français.

4. "should_publish" (boolean) : mettre FALSE uniquement si le texte ne contient AUCUNE information utile (dépôt administratif pur, agenda vide, procédure sans contenu). Dans tous les autres cas, TRUE.

5. "source_name" (string) : liste les sources citées séparées par des virgules. Si aucune source externe, mettre "Assemblée Nationale".

Réponds UNIQUEMENT avec un objet JSON valide (sans bloc markdown) :
{
  "titre_simplifie": "...",
  "resume_flash": "...",
  "resume_detaille": "...",
  "should_publish": true,
  "source_name": "..."
}`,
          messages: [
            {
              role: 'user',
              content: `Transforme ce compte-rendu parlementaire en information citoyenne percutante :\n\n${cleanedText.substring(0, 15000)}`
            }
          ]
        });

        const msgContent = response.content[0];
        if (!msgContent) throw new Error("DeepSeek response is empty");
        let text = msgContent.text;
        
        // Clean potential markdown wrap
        text = text.trim();
        if (text.startsWith("```json")) {
          text = text.replace(/^```json/, '').replace(/```$/, '').trim();
        }
        
        const summary = JSON.parse(text);

        // 5. Skip content-poor items
        if (summary.should_publish === false) {
          console.log(`[AssembleePipeline] Skipping low-value item: ${item.title}`);
          continue;
        }

        // 6. Insert into Supabase
        const { error: insertError } = await supabase.from('content').insert({
          titre_original: item.title || 'Sans titre',
          titre_simplifie: summary.titre_simplifie,
          resume_flash: summary.resume_flash,
          resume_detaille: summary.resume_detaille,
          source_url: sourceUrl,
          source_name: summary.source_name || 'Assemblée Nationale',
          institution: 'assemblée',
          date_publication: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          date_traitement: new Date().toISOString(),
          raw_text: cleanedText.substring(0, 5000),
          status: 'published'
        });

        if (insertError) throw insertError;

        console.log(`[AssembleePipeline] Successfully inserted: ${summary.titre_simplifie}`);
        itemsProcessed++;
      } catch (err: any) {
        console.error(`[AssembleePipeline] Error processing item ${item.link}:`, err);
        Sentry.captureException(err, {
          tags: { component: 'assemblee-pipeline', item: item.link || 'unknown' }
        });
        itemsErrors++;
      }
    }

    console.log(`[AssembleePipeline] Finished run. Processed: ${itemsProcessed}, Errors: ${itemsErrors}`);
    await logSuccess('assembleePipeline', itemsProcessed, hcId, `Processed ${itemsProcessed} items successfully, ${itemsErrors} errors.`);
    return { processed: itemsProcessed, errors: itemsErrors, status: 'success' };

  } catch (err: any) {
    await logError('assembleePipeline', err, hcId);
    throw err;
  }
}
