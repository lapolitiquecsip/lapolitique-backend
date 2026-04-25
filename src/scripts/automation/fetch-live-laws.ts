import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
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

const SOURCES = [
  { url: 'https://www2.assemblee-nationale.fr/documents/liste?type=projets-loi', category: 'Projet de loi' },
  { url: 'https://www2.assemblee-nationale.fr/documents/liste?type=propositions-loi', category: 'Proposition de loi' }
];

async function fetchLiveLaws() {
  console.log('--- FETCHING LIVE ASSEMBLEE NATIONALE BILLS (PROJETS & PROPOSITIONS) ---');
  
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
      
      let count = 0;
      $('ul.liens-liste li[data-id], .liens-liste li[data-id]').each((i, el) => {
        const id = $(el).attr('data-id')?.replace('OMC_', '');
        const title = $(el).find('h3').text().trim();
        // The date is often in a span with text like "Mis en ligne lundi 20 avril 2026 à 00h00" or just "20 avril 2026"
        const dateTextRaw = $(el).find('span.heure, .date').text().trim();
        const subtitle = $(el).find('p').first().text().trim();
        
        // Regex to find "20 avril 2026"
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
            summary: subtitle || `${source.category} mis à jour le ${dateTextRaw || 'récemment'}. Récupéré en direct.`,
            context: `[${dateIso}] Dossier n°${id.split('B')[1] || id}`,
            category: source.category,
            source_urls: [fullDossierLink],
            published_at: publishedAt,
            created_at: new Date().toISOString()
          });
          count++;
        }
      });
      console.log(`  - Found ${count} ${source.category}s`);
    }

    if (allBills.length === 0) {
      console.log("! No bills found. Check selectors.");
      return;
    }

    // Sort bills by published_at ASC (oldest first for insertion, so newest gets latest created_at)
    // However, since frontend sorts by context [YYYY-MM-DD], the insertion order is mostly for created_at consistency.
    allBills.sort((a, b) => (a.published_at || 0) - (b.published_at || 0));

    console.log(`\n> Syncing ${allBills.length} total bills with database...`);

    let updatedCount = 0;
    for (const bill of allBills) {
      const { published_at, ...billToSync } = bill;
      
      // We match by title to avoid duplicates but allow updates
      const { data: existing } = await supabase
        .from('laws')
        .select('id')
        .eq('title', bill.title)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('laws')
          .update(billToSync)
          .eq('id', existing.id);
      } else {
        await supabase
          .from('laws')
          .insert(billToSync);
      }
      updatedCount++;
      
      // Tiny delay to avoid hitting rate limits too hard if we have many
      if (updatedCount % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`\nTERMINE : ${updatedCount} textes législatifs synchronisés.`);

  } catch (error) {
    console.error('Error fetching live laws:', error);
  }
}

fetchLiveLaws();
