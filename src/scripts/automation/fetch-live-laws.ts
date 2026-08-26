import { supabase } from '../../config/supabase.js';
import * as cheerio from 'cheerio';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { logStart, logSuccess, logError } from '../../lib/monitoring.js';
import { resilientDeepSeek } from '../../lib/deepseek-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const SOURCES = [
  { url: 'https://www2.assemblee-nationale.fr/documents/liste?type=projets-loi', category: 'Projet de loi' },
  { url: 'https://www2.assemblee-nationale.fr/documents/liste?type=propositions-loi', category: 'Proposition de loi' }
];

async function generateBillAnalysis(bill: any, dossierHtml: string) {
  const $ = cheerio.load(dossierHtml);
  
  // Try to find the status (Etape)
  const statusLabel = $('.dossier-etape-label').first().text().trim() || 
                      $('.etape-label').first().text().trim();

  if (!$('.dossier-etape-label').length && !$('.etape-label').length) {
    console.warn(`[WARNING] SELECTOR_NOT_FOUND: '.dossier-etape-label' / '.etape-label' on dossier page: ${bill.source_urls[0]}`);
  }

  const status = statusLabel || "Dépôt du texte";

  // Try to find more context (Exposé des motifs summary or similar)
  const introText = $('.dossier-intro').text().trim() || 
                    $('.expose-motifs').text().trim() || 
                    bill.summary;

  const prompt = `Tu es un expert en droit parlementaire français.
Analyse ce projet ou proposition de loi :
Titre : ${bill.title}
Auteur (extrait basique) : ${bill.author}
Type : ${bill.category}
Extrait du dossier : ${introText.substring(0, 2000)}

Génère un JSON avec les champs suivants :
- summary: Un résumé court et clair pour le grand public (2-3 phrases).
- premium_summary: Un résumé TRÈS DÉTAILLÉ et PRÉCIS pour les membres Premium. Tu dois obligatoirement utiliser les titres suivants en majuscules :
  CONTEXTE : (pour expliquer pourquoi le texte est déposé)
  MESURES PROPOSÉES : (pour détailler ce que le texte propose concrètement, avec des retours à la ligne pour chaque mesure).
  Sois technique et exhaustif, inclus tous les chiffres clés.
- status: L'état d'avancement actuel (ex: "En commission", "Adopté en 1ère lecture", etc. basé sur ${status}).
- author: L'initiateur exact du texte (ex: "Le Gouvernement" pour un projet de loi, ou le nom du député/sénateur pour une proposition). Si tu le trouves dans le texte, utilise-le, sinon garde "${bill.author}".

Réponds UNIQUEMENT avec le JSON.`;

  try {
    const response = await resilientDeepSeek.createMessage({
      model: "deepseek-chat",
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

export async function syncLiveLaws() {
  const hcId = process.env.HEALTHCHECK_ID_LIVE_LAWS;
  await logStart('syncLiveLaws', hcId);
  
  const allBills: any[] = [];
  const months: { [key: string]: string } = {
    janvier: '01', février: '02', mars: '03', avril: '04', mai: '05', juin: '06',
    juillet: '07', août: '08', septembre: '09', octobre: '10', novembre: '11', décembre: '12'
  };

  let scrapedCount = 0;
  let insertedCount = 0;

  try {
    // 1. Load all deputies from DB for name-matching
    const { data: dbDeputies } = await supabase
      .from('deputies')
      .select('first_name, last_name');
    const deputyNames = dbDeputies?.map(d => `${d.first_name} ${d.last_name}`) || [];

    // 2. Load all existing laws for duplicate check cache
    const existingLaws: any[] = [];
    let page = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('laws')
        .select('id, title, source_urls, content, timeline, summary, author')
        .range(page * pageSize, (page + 1) * pageSize - 1);
      
      if (error) throw error;
      if (!data || data.length === 0) break;
      existingLaws.push(...data);
      if (data.length < pageSize) break;
      page++;
    }
    
    const lawMapByUrl = new Map<string, any>();
    const lawMapByTitle = new Map<string, any>();
    
    if (existingLaws) {
      for (const row of existingLaws) {
        if (row.title) {
          lawMapByTitle.set(row.title.trim(), row);
        }
        if (row.source_urls) {
          for (const url of row.source_urls) {
            lawMapByUrl.set(url.trim(), row);
          }
        }
      }
    }

    for (const source of SOURCES) {
      console.log(`\n> Scraping ${source.category} from: ${source.url}`);
      const response = await fetch(source.url);
      if (!response.ok) throw new Error(`HTTP Error ${response.status} fetching source: ${source.url}`);
      
      const html = await response.text();
      const $ = cheerio.load(html);
      
      const listSelector = 'ul.liens-liste li[data-id], .liens-liste li[data-id]';
      const items = $(listSelector);
      
      if (items.length === 0) {
        throw new Error(`SELECTOR_NOT_FOUND: '${listSelector}' (no bills found in list on ${source.url})`);
      }
      
      items.each((i, el) => {
        const rawId = $(el).attr('data-id');
        const id = rawId?.replace('OMC_', '');
        
        const h3El = $(el).find('h3');
        if (h3El.length === 0) {
          console.warn(`[WARNING] SELECTOR_NOT_FOUND: 'h3' (title) in list item on ${source.url}`);
        }
        const title = h3El.text().trim();
        
        const dateEl = $(el).find('span.heure, .date');
        if (dateEl.length === 0) {
          console.warn(`[WARNING] SELECTOR_NOT_FOUND: 'span.heure, .date' in list item on ${source.url}`);
        }
        const dateTextRaw = dateEl.text().trim();
        
        const subtitleEl = $(el).find('p').first();
        if (subtitleEl.length === 0) {
          console.warn(`[WARNING] SELECTOR_NOT_FOUND: 'p' (subtitle) in list item on ${source.url}`);
        }
        const subtitle = subtitleEl.text().trim();
        
        let author = source.category === 'Projet de loi' ? 'Le Gouvernement' : '';
        if (source.category === 'Proposition de loi') {
          // 1. Try to find the author link (usually cleanest)
          const authorLink = $(el).find('p a[href*="/deputes/"]').first();
          if (authorLink.length > 0) {
            author = authorLink.text().trim();
          } else {
            // 2. Try to match name from subtitle text using regex
            const authorMatch = subtitle.match(/(?:proposition de loi|projet de loi)[^]*? de (?:M\.|Mme|MM\.|Mmes)?\s*([^,]+?)(?:\s+et plusieurs|\s+visant|\s+relative|\s+tendant|\s+relativement|\s+déposée|$)/i);
            if (authorMatch) {
              author = authorMatch[1].trim();
            } else {
              author = "Député(s)";
            }
          }

          // 3. Scan subtitle for known deputy names as a fallback
          if (!author || author === 'Député(s)') {
            const matchedDeputies: string[] = [];
            for (const name of deputyNames) {
              if (subtitle.toLowerCase().includes(name.toLowerCase())) {
                matchedDeputies.push(name);
              }
            }
            if (matchedDeputies.length > 0) {
              author = matchedDeputies.join(', ');
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

    scrapedCount = allBills.length;
    // Sort to process newest first
    allBills.sort((a, b) => b.published_at - a.published_at);

    console.log(`\n> Analyzing up to ${Math.min(allBills.length, 100)} newest bills...`);

    for (const bill of allBills) {
      const urlKey = bill.source_urls[0].trim();
      const titleKey = bill.title.trim();
      const existing = lawMapByUrl.get(urlKey) || lawMapByTitle.get(titleKey);
      
      // Only process if new OR missing premium content OR status is placeholder OR has fallback/generic summary OR has a generic author
      const isGeneric = existing && (
        existing.summary?.startsWith("Dossier législatif") ||
        existing.content === "Détails du dossier disponibles sur le site de l'Assemblée nationale."
      );
      const isGenericAuthor = !existing || !existing.author || existing.author === 'Député(s)' || existing.author === 'Non spécifié';
      const needsAnalysis = !existing || !existing.content || existing.timeline === "Analyse du parcours législatif en cours..." || isGeneric || (bill.category === 'Proposition de loi' && isGenericAuthor);
      
      if (needsAnalysis) {
        if (insertedCount >= 100) {
          console.log("\nReached 100 analyses limit for this run.");
          break;
        }
        console.log(`\nProcessing: ${bill.title}`);
        
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
            author: analysis.author || bill.author,
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
          insertedCount++;
        } else {
          // Fallback if AI fails
          const { published_at, ...billToSync } = bill;
          if (existing) {
            await supabase.from('laws').update(billToSync).eq('id', existing.id);
            console.log("  ✅ Updated with fallback data");
          } else {
            await supabase.from('laws').insert(billToSync);
            insertedCount++;
            console.log("  ✅ Inserted with fallback data");
          }
        }
      }
    }

    const alreadyUpToDateCount = scrapedCount - insertedCount;
    const msg = `scraped: ${scrapedCount}, already_up_to_date: ${alreadyUpToDateCount}, inserted: ${insertedCount}`;
    console.log(`\n--- SYNCHRONIZATION COMPLETE : ${msg} ---`);
    await logSuccess('syncLiveLaws', insertedCount, hcId, msg);
    return insertedCount;

  } catch (error: any) {
    await logError('syncLiveLaws', error, hcId);
    throw error;
  }
}

// Standalone execution support
const nodePath = fs.realpathSync(process.argv[1]);
const currentPath = fileURLToPath(import.meta.url);
if (nodePath === currentPath || nodePath.endsWith('fetch-live-laws.ts') || nodePath.endsWith('fetch-live-laws.js')) {
  syncLiveLaws().catch(console.error);
}
