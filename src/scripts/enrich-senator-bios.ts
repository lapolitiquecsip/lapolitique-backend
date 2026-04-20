import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const normalizeForUrl = (s: string) =>
  s.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_$/g, "");

async function enrichSenatorBios(limit: number = 5) {
  console.log(`Starting enrichment for ${limit} senators...`);

  // 1. Get List (or fetch from the OpenData JSON to get the Matricule)
  const response = await fetch('https://data.senat.fr/data/senateurs/ODSEN_GENERAL.json');
  const data = await response.json();
  const activeSenators = data.results.filter((s: any) => s.Etat === 'ACTIF').slice(0, limit);

  for (const s of activeSenators) {
    const firstName = s.Prenom_usuel;
    const lastName = s.Nom_usuel;
    const matricule = s.Matricule.toLowerCase();
    const urlName = `${normalizeForUrl(lastName)}_${normalizeForUrl(firstName)}`;
    const url = `https://www.senat.fr/senateur/${urlName}${matricule}.html`;

    console.log(`Processing: ${firstName} ${lastName} (${url})`);

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      if (!res.ok) {
        console.warn(`Could not fetch URL for ${firstName} ${lastName}`);
        continue;
      }
      const html = await res.text();
      const $ = cheerio.load(html);

      // Extract Data using verified selectors
      const birthText = $('.dl-horizontal dt:contains("État civil")').next('dd').text().trim(); // "Né le 20 février 1961"
      const profession = $('.dl-horizontal dt:contains("Profession")').next('dd').text().trim() || "Information non disponible";

      // Calculate Age
      let ageText = "";
      const birthDateMatch = birthText.match(/(\d{1,2})\s+([^\s\d]+)\s+(\d{4})/i);
      if (birthDateMatch) {
        const day = parseInt(birthDateMatch[1]);
        const monthStr = birthDateMatch[2].toLowerCase();
        const year = parseInt(birthDateMatch[3]);
        
        const months: Record<string, number> = {
          'janvier': 0, 'février': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5,
          'juillet': 6, 'août': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11
        };
        const month = months[monthStr] ?? 0;
        const birthDate = new Date(year, month, day);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
        ageText = ` (âgé(e) de ${age} ans)`;
      }

      // Extract Main Functions (Senate)
      const functions = $('h3:contains("Commissions, Délégations et Office")').next('ul').find('li').map((i, el) => $(el).text().trim()).get().slice(0, 2).join(', ') || "Information non disponible";

      // Extract Mandates - Look for 'Mandats locaux' section
      const mandates = $('h3:contains("Mandats locaux")').nextAll('p, ul').first().text().trim().substring(0, 100) || "Aucun mandat local renseigné";

      // Synthesis: Formal Summary
      const formalSummary = `M./Mme ${lastName} est ${birthText.toLowerCase()}${ageText}. Professionnellement, il/elle est ${profession}. Au Sénat, il/elle occupe notamment les fonctions de ${functions}. Il/Elle a par ailleurs exercé ou exerce les mandats de ${mandates}.`;

      console.log(`- Generated Bio for ${lastName}: ${formalSummary.substring(0, 150)}...`);

      // Update DB
      const slug = `${normalizeForUrl(firstName).replace(/_/g, '-')}-${normalizeForUrl(lastName).replace(/_/g, '-')}`;
      
      const { error } = await supabase
        .from('senators')
        .update({ 
          biography: formalSummary 
        })
        .eq('slug', slug);

      if (error) console.error(`Error updating ${slug}:`, error);

    } catch (err) {
      console.error(`Failed to process ${firstName} ${lastName}`, err);
    }

    // Delay to respect server
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('Batch enrichment completed.');
}

// Run for 5 first
enrichSenatorBios(5);
