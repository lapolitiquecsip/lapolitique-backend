import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
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
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SOURCES = [
  { url: 'https://www2.assemblee-nationale.fr/documents/liste?type=projets-loi', category: 'Projet de loi' },
  { url: 'https://www2.assemblee-nationale.fr/documents/liste?type=propositions-loi', category: 'Proposition de loi' }
];

async function generateBillAnalysis(bill: any, dossierHtml: string) {
  const $ = cheerio.load(dossierHtml);
  
  // Try to find the status (Etape)
  const status = $('.dossier-etape-label').first().text().trim() || 
                 $('.etape-label').first().text().trim() || 
                 "Dépôt du texte";

  // Try to find more context (Exposé des motifs summary or similar)
  const introText = $('.dossier-intro').text().trim() || 
                    $('.expose-motifs').text().trim() || 
                    bill.summary;

  const prompt = `Tu es un expert en droit parlementaire français.
Analyse ce projet ou proposition de loi :
Titre : ${bill.title}
Auteur : ${bill.author}
Type : ${bill.category}
Extrait du dossier : ${introText.substring(0, 2000)}

Génère un JSON avec les champs suivants :
- summary: Un résumé court et clair pour le grand public (2-3 phrases).
- premium_summary: Un résumé TRÈS DÉTAILLÉ et PRÉCIS pour les membres Premium. Tu dois obligatoirement utiliser les titres suivants en majuscules :
  CONTEXTE : (pour expliquer pourquoi le texte est déposé)
  MESURES PROPOSÉES : (pour détailler ce que le texte propose concrètement, avec des retours à la ligne pour chaque mesure).
  Sois technique et exhaustif, inclus tous les chiffres clés.
- status: L'état d'avancement actuel (ex: "En commission", "Adopté en 1ère lecture", etc. basé sur ${status}).

Réponds UNIQUEMENT avec le JSON.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-3-opus-20240229",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }]
    });

    const content = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error(`Error generating analysis for ${bill.title}:`, error);
  }
  return null;
}

async function fetchLiveLaws() {
  console.log('--- FETCHING LIVE ASSEMBLEE NATIONALE BILLS WITH AI ANALYSIS ---');
  
  const allBills: any[] = [];
  const months: { [key: string]: string } = {
    janvier: '01', février: '02', mars: '03', avril: '04', mai: '05', juin: '06',
    juillet: '07', août: '08', septembre: '09', octobre: '10', novembre: '11', décembre: '12'
  };

  try {
    for (const source of SOURCES) {
      console.log(`\n> Scraping ${source.category} from: ${source.url}`);
      const response = await fetch(source.url);
      const html = await response.text();
      const $ = cheerio.load(html);
      
      $('ul.liens-liste li[data-id], .liens-liste li[data-id]').each((i, el) => {
        const id = $(el).attr('data-id')?.replace('OMC_', '');
        const title = $(el).find('h3').text().trim();
        const dateTextRaw = $(el).find('span.heure, .date').text().trim();
        const subtitle = $(el).find('p').first().text().trim();
        
        let author = source.category === 'Projet de loi' ? 'Le Gouvernement' : '';
        if (source.category === 'Proposition de loi') {
          // 1. Try to find the author link (usually cleanest)
          const authorLink = $(el).find('p a[href*="/deputes/"]').first();
          if (authorLink.length > 0) {
            author = authorLink.text().trim();
          } else {
            // 2. Fallback to subtitle parsing with refined regex
            const authorMatch = subtitle.match(/(?:de loi organique de|de loi de)\s+([^,]+?)(?:\s+et plusieurs|\s+relative|\s+visant|\s+déposée|$)/i);
            if (authorMatch) {
              author = authorMatch[1].trim();
            } else {
              author = "Député(s)";
            }
          }
        }

        const dateMatch = dateTextRaw.match(/(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i);
        let publishedAt: number = 0;
        let dateIso = '1900-01-01';

        if (dateMatch) {
          const day = dateMatch[1].padStart(2, '0');
          const month = months[dateMatch[2].toLowerCase()] || '01';
          const year = dateMatch[3];
          publishedAt = parseInt(`${year}${month}${day}`);
          dateIso = `${year}-${month}-${day}`;
        }

        if (title && id) {
          const legis = id.match(/L(\d+)/)?.[1] || "17";
          const fullDossierLink = `https://www.assemblee-nationale.fr/dyn/${legis}/dossiers_legislatifs/${id}`;

          allBills.push({
            title: title.replace(/&amp;#13;/g, ' ').replace(/\s+/g, ' '),
            summary: subtitle || `${source.category} mis à jour le ${dateTextRaw || 'récemment'}.`,
            context: `[${dateIso}] Dossier n°${id.split('B')[1] || id}`,
            category: source.category,
            author: author,
            source_urls: [fullDossierLink],
            published_at: publishedAt
          });
        }
      });
    }

    // Sort to process newest first
    allBills.sort((a, b) => b.published_at - a.published_at);

    console.log(`\n> Analyzing up to ${Math.min(allBills.length, 100)} newest bills...`);

    let processedCount = 0;
    for (const bill of allBills) {
      // No more 20 limit to ensure all laws are processed
      // but we skip if it already has premium content AND timeline is not the placeholder
      
      const { data: existing } = await supabase
        .from('laws')
        .select('id, content, timeline')
        .eq('title', bill.title)
        .maybeSingle();

      // Only process if new OR missing premium content OR status is placeholder
      const needsAnalysis = !existing || !existing.content || existing.timeline === "Analyse du parcours législatif en cours...";
      
      if (needsAnalysis) {
        if (processedCount >= 100) {
          console.log("\nReached 100 analyses limit for this run.");
          break;
        }
        console.log(`\nProcessing: ${bill.title}`);
        processedCount++;
        
        // Wait a bit to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 800));
        
        let dossierHtml = "";
        try {
          const dossierResp = await fetch(bill.source_urls[0]);
          dossierHtml = await dossierResp.text();
        } catch (e) {
          console.warn(`Could not fetch dossier page for ${bill.title}`);
        }

        const analysis = await generateBillAnalysis(bill, dossierHtml);
        if (analysis) {
          const billToSync = {
            ...bill,
            summary: analysis.summary,
            content: analysis.premium_summary, // We use 'content' for premium
            timeline: analysis.status,         // We use 'timeline' for status
            created_at: new Date().toISOString()
          };
          delete (billToSync as any).published_at;

          if (existing) {
            await supabase.from('laws').update(billToSync).eq('id', existing.id);
            console.log("  ✅ Updated with AI analysis");
          } else {
            await supabase.from('laws').insert(billToSync);
            console.log("  ✅ Inserted with AI analysis");
          }
        } else {
          // Fallback if AI fails
          const { published_at, ...billToSync } = bill;
          if (!existing) await supabase.from('laws').insert(billToSync);
        }
      }
    }

    console.log(`\nTERMINE : ${processedCount} textes législatifs traités.`);

  } catch (error) {
    console.error('Error fetching live laws:', error);
  }
}

fetchLiveLaws();
