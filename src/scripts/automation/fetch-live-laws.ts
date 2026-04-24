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

const LIVE_LAWS_URL = 'https://www2.assemblee-nationale.fr/documents/liste?type=projets-loi';

async function fetchLiveLaws() {
  console.log('--- FETCHING LIVE ASSEMBLEE NATIONALE BILLS (PROJETS DE LOI) ---');
  
  try {
    const response = await fetch(LIVE_LAWS_URL);
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Each bill is typically in an <li> within a specific container
    const bills: any[] = [];
    
    $('ul.liens-liste li[data-id]').each((i, el) => {
      const id = $(el).attr('data-id')?.replace('OMC_', '');
      const title = $(el).find('h3').text().trim();
      const dateText = $(el).find('span.heure').text().trim();
      const subtitle = $(el).find('p').first().text().trim();
      
      if (title && id) {
        // Pattern: PRJLANR5L17B2694 -> 17 is the legislature
        const legis = id.match(/L(\d+)/)?.[1] || "17";
        const fullDossierLink = `https://www.assemblee-nationale.fr/dyn/${legis}/dossiers_legislatifs/${id}`;

        bills.push({
          title: title.replace(/&amp;#13;/g, ' '),
          summary: subtitle || `Projet de loi mis à jour le ${dateText || 'récemment'}. Récupéré en direct.`,
          context: `Dossier n°${id.split('B')[1] || id}`,
          category: "Projet de loi",
          source_urls: [fullDossierLink],
          created_at: new Date().toISOString()
        });
      }
    });

    // Fallback search if the previous selectors failed (selectors can be tricky on AN site)
    if (bills.length === 0) {
        $('h3').each((i, el) => {
            const h3Text = $(el).text().trim();
            const parent = $(el).parent();
            const link = parent.find('a[href*="dossiers_legislatifs"]').attr('href') || parent.find('a[href*="dossier-legislatif"]').attr('href');
            
            if (h3Text && link) {
                bills.push({
                    title: h3Text,
                    summary: "Projet de loi mis à jour en temps réel.",
                    context: "Projet de Loi",
                    category: "Projet de loi",
                    source_urls: [link.startsWith('http') ? link : `https://www.assemblee-nationale.fr${link}`]
                });
            }
        });
    }

    console.log(`> Found ${bills.length} bills. Syncing with database...`);

    let updatedCount = 0;
    for (const bill of bills) {
      // Manual "upsert" because of missing unique constraint on title
      const { data: existing } = await supabase
        .from('laws')
        .select('id')
        .eq('title', bill.title)
        .single();

      if (existing) {
        const { error } = await supabase
          .from('laws')
          .update(bill)
          .eq('id', existing.id);
        if (!error) updatedCount++;
        else console.error(`Error updating ${bill.title}:`, error.message);
      } else {
        const { error } = await supabase
          .from('laws')
          .insert(bill);
        if (!error) updatedCount++;
        else console.error(`Error inserting ${bill.title}:`, error.message);
      }
    }

    console.log(`\nTERMINE : ${updatedCount} projets de loi synchronisés.`);

  } catch (error) {
    console.error('Error fetching live laws:', error);
  }
}

fetchLiveLaws();
