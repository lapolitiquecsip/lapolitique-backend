
import { supabase } from '../../config/supabase.js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { logStart, logSuccess, logError } from '../../lib/monitoring.js';
import { resilientDeepSeek } from '../../lib/deepseek-client.js';

dotenv.config();

export async function summarizeScrutins() {
  const hcId = process.env.HEALTHCHECK_ID_SUMMARIZER;
  await logStart('summarizeScrutins', hcId);

  let summarizedCount = 0;

  try {
    // Fetch scrutins without summary (strictly empty to respect user's "don't change already done" wish)
    const { data: scrutins, error } = await supabase
      .from('scrutins')
      .select('id, objet, title')
      .in('type', ['LOI']) // Focus on Laws as requested
      .is('summary', null)
      .ilike('title', "l'ensemble%") // votes solennels sur l'ensemble d'un texte (les vraies « lois »)
      .order('date_scrutin', { ascending: false })
      .limit(Number(process.env.SCRUTIN_SUMMARIZE_LIMIT || 40)); // débit configurable

    if (error) {
      throw error;
    }

    console.log(`> Found ${scrutins.length} laws to summarize.`);

    for (const s of scrutins) {
      try {
        console.log(`Processing: ${s.objet}`);

        // deepseek-chat (non-raisonneur, peu cher) en priorité ; flash en repli.
        const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-v4-flash'];

        let success = false;
        for (const model of DEEPSEEK_MODELS) {
          try {
            const response = await resilientDeepSeek.createMessage({
              model: model,
              max_tokens: 1000,
              messages: [
                {
                  role: 'user',
                  content: `Tu expliques à un citoyen le SUJET d'un texte voté à l'Assemblée nationale, à partir de son INTITULÉ officiel (souvent procédural, ex. « l'ensemble du projet de loi relatif à … »).

                  Intitulé : ${s.objet || s.title}

                  Consignes IMPÉRATIVES :
                  - L'intitulé SUFFIT : identifie le sujet de fond et explique-le. Ne refuse JAMAIS, ne réclame jamais « le texte complet », ne dis jamais qu'il « n'a pas été fourni ».
                  - Reste neutre, factuel, pédagogique. Aucun jugement de valeur ni orientation politique.
                  - N'INVENTE PAS de chiffres : ne cite un budget, une somme ou une date QUE s'ils figurent dans l'intitulé. Sinon, parle des objectifs et mesures en termes généraux.

                  Réponds au format JSON STRICT :
                  {
                    "summary": "Résumé en 2-3 phrases du sujet du texte",
                    "why_it_matters": "Pourquoi ce sujet compte concrètement pour le citoyen",
                    "detailed_summary": "Résumé plus détaillé (min. 4 phrases) de ce que vise le texte et des mesures qu'il porte, déduites du sujet ; factuel, sans chiffres inventés.",
                    "category": "Choisir STRICTEMENT parmi: Économie, Social, Santé, Éducation, Environnement, Sécurité"
                  }

                  RENVOIE UNIQUEMENT LE JSON.`
                }
              ],
            });

            const content = response.content[0];
            const responseBody = content.type === 'text' ? content.text : '';

            // Robust JSON extraction
            const jsonMatch = responseBody.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON found in response');

            const result = JSON.parse(jsonMatch[0]);

            // Garde-fou anti-refus : si le modèle répond « je ne peux pas / texte non fourni… »,
            // on NE stocke PAS ce placeholder (on tente le modèle suivant, sinon on laisse null →
            // re-tenté au prochain passage). Évite d'afficher un faux résumé au citoyen.
            const REFUSAL = /(n'?a pas été fourni|je ne peux pas|impossible d'expliquer|fournir (le|un) (texte|contenu|résumé)|contenu (complet|spécifique)|veuillez fournir|sans le (texte|contenu))/i;
            if (!result.summary || result.summary.trim().length < 15
                || REFUSAL.test(result.summary) || REFUSAL.test(result.why_it_matters || '')) {
              throw new Error('Réponse de refus/placeholder — non stockée');
            }

            const { error: uError } = await supabase
              .from('scrutins')
              .update({
                summary: result.summary,
                why_it_matters: `${result.why_it_matters}|||DETAILED|||${result.detailed_summary || "Détails supplémentaires non disponibles."}`,
                category: result.category
              })
              .eq('id', s.id);

            if (uError) throw uError;
            
            console.log(`✅ Success for ${s.id} using ${model}`);
            success = true;
            summarizedCount++;
            break; // Next scrutin
          } catch (mErr: any) {
            console.error(`⚠️ Model ${model} failed for ${s.id}: ${mErr.status || mErr.message}`);
            continue; // Try next model
          }
        }

        if (!success) {
          console.error(`❌ All models failed for ${s.id}`);
        }

      } catch (err: any) {
        console.error(`❌ Global error for ${s.id}:`, err.message);
      }
    }

    await logSuccess('summarizeScrutins', summarizedCount, hcId);
    return summarizedCount;

  } catch (err: any) {
    await logError('summarizeScrutins', err, hcId);
    throw err;
  }
}

// Standalone execution support
const nodePath = fs.realpathSync(process.argv[1]);
const currentPath = fileURLToPath(import.meta.url);
if (nodePath === currentPath || nodePath.endsWith('scrutin-summarizer.ts') || nodePath.endsWith('scrutin-summarizer.js')) {
  summarizeScrutins().catch(console.error);
}
