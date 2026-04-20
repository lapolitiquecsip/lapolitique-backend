import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../config/supabase';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});
const parser = new Parser();

const MAX_RETRIES = 3;

/**
 * Fetch with exponential backoff
 */
async function generateSummaryWithRetry(content: string, retryCount = 0): Promise<any> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307", // Fast and cheap
      max_tokens: 1024,
      system: "Tu es un journaliste pédagogue experte en politique française. Tu dois toujours répondre UNIQUEMENT avec un objet JSON (sans le bloc de code markdown, juste l'accolade).",
      messages: [
        {
          role: "user",
          content: `Résume ce texte de loi ou compte-rendu parlementaire pour un lycéen. Produis un JSON strict ayant exactement cette structure et RIEN d'autre :
{
  "titre_simplifie": "string (max 15 mots)",
  "resume_flash": "string (3 lignes max)",
  "resume_detaille": "string (10-15 lignes)"
}

Texte brut :
${content.substring(0, 15000)}` 
        }
      ]
    });

    const msgContent = response.content[0];
    if (!msgContent) throw new Error("Anthropic response is empty");
    let text = "";
    if (msgContent.type === "text") {
      text = msgContent.text;
    }
    
    // Clean potential markdown wrap
    text = text.trim();
    if (text.startsWith("```json")) {
      text = text.replace(/^```json/, '').replace(/```$/, '').trim();
    }
    
    return JSON.parse(text);
  } catch (error) {
    if (retryCount < MAX_RETRIES - 1) {
      const waitTime = Math.pow(2, retryCount) * 1000;
      console.warn(`[AssembleePipeline] Anthropic error, retrying in ${waitTime}ms...`, error);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return generateSummaryWithRetry(content, retryCount + 1);
    }
    throw error;
  }
}

export async function runAssembleePipeline() {
  console.log(`[AssembleePipeline] Starting run at ${new Date().toISOString()}`);
  let itemsProcessed = 0;
  let itemsErrors = 0;
  let pipelineError = null;

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

        // 4. Send to Anthropic
        const summary = await generateSummaryWithRetry(cleanedText);

        // 5. Insert into Supabase
        const { error: insertError } = await supabase.from('content').insert({
          titre_original: item.title || 'Sans titre',
          titre_simplifie: summary.titre_simplifie,
          resume_flash: summary.resume_flash,
          resume_detaille: summary.resume_detaille,
          source_url: sourceUrl,
          institution: 'assemblée',
          date_publication: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          date_traitement: new Date().toISOString(),
          raw_text: cleanedText.substring(0, 5000), // store a trunk to avoid massive rows
          status: 'published'
        });

        if (insertError) throw insertError;

        console.log(`[AssembleePipeline] Successfully inserted: ${summary.titre_simplifie}`);
        itemsProcessed++;
      } catch (err) {
        console.error(`[AssembleePipeline] Error processing item ${item.link}:`, err);
        itemsErrors++;
      }
    }
  } catch (err: any) {
    console.error(`[AssembleePipeline] Global Error:`, err);
    pipelineError = err.message || JSON.stringify(err);
  }

  // Log execution
  await supabase.from('pipeline_logs').insert({
    pipeline_name: 'assemblee',
    items_processed: itemsProcessed,
    items_errors: itemsErrors,
    status: pipelineError ? 'error' : 'success',
    error_details: pipelineError
  });

  console.log(`[AssembleePipeline] Finished run. Processed: ${itemsProcessed}, Errors: ${itemsErrors}`);
  return { processed: itemsProcessed, errors: itemsErrors, status: pipelineError ? 'error' : 'success' };
}
