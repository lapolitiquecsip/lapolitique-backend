import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import * as dotenv from 'dotenv';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

async function generateBillAnalysis(bill: any, dossierHtml: string) {
  const $ = cheerio.load(dossierHtml);
  const status = $('.dossier-etape-label').first().text().trim() || 
                 $('.etape-label').first().text().trim() || 
                 "Dépôt du texte";
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
  return null;
}

async function run() {
  const { data: bill } = await supabase
    .from('laws')
    .select('*')
    .ilike('title', '%2743%')
    .single();

  if (!bill) {
    console.log("Loi 2743 non trouvée");
    return;
  }

  console.log(`Analyse de : ${bill.title}`);
  
  let dossierHtml = "";
  if (bill.source_urls && bill.source_urls[0]) {
    try {
      const resp = await fetch(bill.source_urls[0]);
      dossierHtml = await resp.text();
    } catch (e) {
      console.warn("Could not fetch dossier page");
    }
  }

  const analysis = await generateBillAnalysis(bill, dossierHtml);
  if (analysis) {
    await supabase.from('laws').update({
      summary: analysis.summary,
      content: analysis.premium_summary,
      timeline: analysis.status,
      created_at: new Date().toISOString()
    }).eq('id', bill.id);
    console.log("✅ Analyse générée et mise à jour");
  } else {
    console.log("❌ Échec de la génération de l'analyse");
  }
}

run();
