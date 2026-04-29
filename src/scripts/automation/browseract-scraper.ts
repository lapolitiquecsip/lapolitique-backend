import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
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

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const BROWSERACT_API_KEY = process.env.BROWSERACT_API_KEY;
const WORKFLOW_ID = process.env.BROWSERACT_WORKFLOW_ID;

const SOURCES = [
  { url: 'https://www2.assemblee-nationale.fr/documents/liste?type=projets-loi', category: 'Projet de loi' },
  { url: 'https://www2.assemblee-nationale.fr/documents/liste?type=propositions-loi', category: 'Proposition de loi' }
];

async function runBrowserAct(targetUrl: string) {
  console.log(`\n> Lancement de BrowserAct pour : ${targetUrl}`);
  
  if (!BROWSERACT_API_KEY || !WORKFLOW_ID) {
    throw new Error('BROWSERACT_API_KEY or BROWSERACT_WORKFLOW_ID is missing in .env');
  }

  const response = await fetch('https://api.browseract.com/v2/workflow/run-task', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BROWSERACT_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      workflow_id: WORKFLOW_ID,
      input_parameters: [
        { name: 'target_url', value: targetUrl }
      ]
    })
  });

  const result = await response.json();
  
  const taskId = result.id || result.task_id;

  if (taskId) {
    console.log(`  - Tâche lancée avec succès (ID: ${taskId}). En attente des résultats...`);
    return pollResults(taskId);
  }
  
  if (result.status === 'success' && result.data) {
    const output = result.data.output || result.data;
    return Array.isArray(output) ? output : [];
  }
  
  throw new Error(`Erreur lors du lancement BrowserAct: ${JSON.stringify(result)}`);
}

async function pollResults(taskId: string): Promise<any[]> {
  const maxRetries = 90; // 15 minutes max
  for (let i = 0; i < maxRetries; i++) {
    await new Promise(resolve => setTimeout(resolve, 10000)); // Attendre 10s
    
    const response = await fetch(`https://api.browseract.com/v2/workflow/get-task?task_id=${taskId}`, {
      headers: { 'Authorization': `Bearer ${BROWSERACT_API_KEY}` }
    });
    const result = await response.json();
    
    if (result.status === 'success') {
      console.log(`  ✅ Tâche terminée avec succès !`);
      const output = result.data.output || result.data;
      return Array.isArray(output) ? output : [];
    }
    
    if (result.status === 'failed') {
      throw new Error(`❌ Tâche BrowserAct échouée: ${JSON.stringify(result.error)}`);
    }
    
    process.stdout.write(`.`); // Petit point pour montrer qu'on attend
    if ((i + 1) % 6 === 0) console.log(` (${(i + 1) * 10}s / 900s)`);
  }
  throw new Error('❌ Timeout BrowserAct après 15 minutes');
}

async function generatePremiumSummary(title: string) {
  console.log(`  - Génération du résumé Premium pour : ${title.substring(0, 50)}...`);
  
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `Résume cette loi de l'Assemblée Nationale pour un citoyen.
        Sois simple, neutre et pédagogique.
        
        Loi : ${title}
        
        Réponds au format JSON STRICT :
        {
          "summary": "Résumé en 2-3 phrases",
          "why_it_matters": "Pourquoi c'est important pour le citoyen",
          "detailed_summary": "Un résumé long et exhaustif (mini 6 phrases) des mesures concrètes proposées par la loi. INCLUS : les budgets prévus, les sommes d'argent exactes, les organismes ou outils créés, et les dates d'application cibles.",
          "category": "Choisir parmi: Économie, Social, Santé, Éducation, Environnement, Sécurité, Justice, Institutions, International, Culture"
        }
        
        RENVOIE UNIQUEMENT LE JSON.`
      }
    ],
  });

  const content = response.content[0];
  const text = content.type === 'text' ? content.text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Claude response');
  return JSON.parse(jsonMatch[0]);
}

async function startScraping() {
  console.log('--- DEBUT DU SCRAPING ECO-INTELLIGENT (BROWSERACT + CLAUDE) ---');

  for (const source of SOURCES) {
    try {
      const laws = await runBrowserAct(source.url);
      console.log(`  - ${laws.length} lois trouvées par BrowserAct.`);

      for (const law of laws) {
        // Vérifier si la loi existe déjà et si elle a un "vrai" contenu Premium
        const { data: existing } = await supabase
          .from('laws')
          .select('id, content')
          .eq('title', law.title)
          .maybeSingle();

        const isPlaceholder = existing && (!existing.content || existing.content.includes("Détails du dossier disponibles"));

        if (!existing || isPlaceholder) {
          if (isPlaceholder) {
            console.log(`\n♻️ MISE À JOUR PREMIUM : ${law.title}`);
          } else {
            console.log(`\n✨ NOUVELLE LOI : ${law.title}`);
          }
          
          try {
            const premium = await generatePremiumSummary(law.title);
            
            // On essaie d'extraire une date ISO du texte de la loi ou on utilise la date du jour
            const dateMatch = law.date ? law.date.match(/(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i) : null;
            let dateIso = new Date().toISOString().split('T')[0];
            
            if (dateMatch) {
                const months: any = { janvier: '01', février: '02', mars: '03', avril: '04', mai: '05', juin: '06', juillet: '07', août: '08', septembre: '09', octobre: '10', novembre: '11', décembre: '12' };
                const day = dateMatch[1].padStart(2, '0');
                const month = months[dateMatch[2].toLowerCase()] || '01';
                const year = dateMatch[3];
                dateIso = `${year}-${month}-${day}`;
            }

            const lawData = {
              title: law.title,
              summary: premium.summary,
              content: `${premium.why_it_matters}\n\n${premium.detailed_summary}`,
              context: `[${dateIso}] Dossier importé`,
              category: premium.category || source.category,
              author: source.category === 'Projet de loi' ? "Le Gouvernement" : (law.author || "Député(s)"),
              source_urls: [law.url],
              timeline: law.status || "Analyse législative en cours",
              created_at: new Date().toISOString()
            };

            const { error: insertError } = existing 
              ? await supabase.from('laws').update(lawData).eq('id', existing.id)
              : await supabase.from('laws').insert(lawData);

            if (insertError) throw insertError;
            console.log(existing ? `✅ Loi mise à jour en version Premium.` : `✅ Loi ajoutée avec succès.`);
          } catch (err: any) {
            console.error(`❌ Erreur lors du traitement de la loi: ${err.message}`);
          }
        } else {
          // On peut mettre à jour si besoin, mais ici on skip pour économiser
          // console.log(`  - Déjà en base : ${law.title.substring(0, 30)}...`);
        }
      }
    } catch (e: any) {
      console.error(`❌ Erreur critique pour ${source.category}:`, e.message);
    }

    console.log(`\n> Attente de 30s avant la source suivante pour ne pas saturer BrowserAct...`);
    await new Promise(resolve => setTimeout(resolve, 30000));
  }

  console.log('\n--- SCRAPING TERMINE ---');
}

startScraping();
