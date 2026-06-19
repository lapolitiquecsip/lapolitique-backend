import { supabase } from '../../config/supabase.js';
import { resilientAnthropic } from '../../lib/anthropic-client.js';
import * as dotenv from 'dotenv';
import crypto from 'crypto';
import { logStart, logSuccess, logError } from '../../lib/monitoring.js';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

export async function generateWeeklyStats() {
  console.log("--- GÉNÉRATION DES STATS HEBDOMADAIRES EXPERTES ---");

  const hcId = process.env.HEALTHCHECK_ID_WEEKLY_STATS;
  await logStart('generateWeeklyStats', hcId);

  try {
    const topics = ["Budget et Économie", "Écologie et Énergie", "Justice et Sécurité", "Santé et Social", "Éducation et Culture", "Institutions et Règlements", "Europe et International"];
  const randomTopic = topics[Math.floor(Math.random() * topics.length)];
  const currentDate = new Date().toLocaleDateString('fr-FR');

  const prompt = `Tu es un expert de haut niveau du Parlement français (Assemblée nationale et Sénat).
Ta mission est de générer 5 informations marquantes et 1 "Intox" hebdomadaires.

CRITÈRE CRUCIAL 1 : Les informations doivent être UTILES et NON-ÉVIDENTES, même pour des personnes qui connaissent déjà très bien la politique.
CRITÈRE CRUCIAL 2 : Tu dois ABSOLUMENT varier tes réponses à chaque génération. Ne répète jamais les mêmes statistiques d'une fois sur l'autre.
Date du jour : ${currentDate}. Pour t'aider à varier, essaie d'inclure au moins un fait lié à ce thème aléatoire : "${randomTopic}".

Évite absolument les généralités comme "Le 49.3 a été utilisé" ou "Yaël Braun-Pivet est présidente".
Cherche des :
- Chiffres techniques précis (ex: taux de réussite des amendements).
- Procédures méconnues ou faits historiques rares.
- Faits récents sur des rapports ou commissions d'enquête.
- Détails budgétaires ou institutionnels pointus.

Format de sortie attendu (JSON uniquement) :
[
  { 
    "type": "fact",
    "value": "chiffre", 
    "label": "description courte avec le chiffre", 
    "color": "un code HEX de couleur VIVE et SATURÉE (ex: #2563eb, #db2777, #7c3aed, #059669, #ea580c)"
  },
  { 
    "type": "did-you-know",
    "category_label": "LE SAVIEZ-VOUS ?",
    "content": "phrase marquante", 
    "color": "#7c3aed"
  },
  { 
    "type": "intox",
    "category_label": "INTOX DE LA SEMAINE",
    "content": "La fausse information entre guillemets",
    "debunk": "La réalité des faits",
    "color": "#dc2626"
  }
]

Génère exactement 5 faits (mélange de chiffres et de "le saviez-vous") et 1 intox.
Sois percutant, précis et utilise des données réelles de la 17ème législature ou de l'histoire parlementaire.
Les couleurs doivent être obligatoirement des codes HEX, VIVES et suffisamment contrastées pour que le texte blanc soit lisible.`;


    const response = await resilientAnthropic.createMessage({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("Pas de JSON trouvé dans la réponse");

    const slides = JSON.parse(jsonMatch[0]);

    const { error } = await supabase.from('events').insert({
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      title: "Stats de la semaine",
      description: JSON.stringify(slides),
      category: "WeeklyStats",
      institution: "Assemblée nationale",
      created_at: new Date().toISOString()
    });

    if (error) throw error;
    console.log("✅ Stats hebdomadaires générées et enregistrées.");
    await logSuccess('generateWeeklyStats', 1, hcId, 'Weekly stats generated successfully.');

  } catch (err: any) {
    await logError('generateWeeklyStats', err, hcId);
    throw err;
  }
}

const nodePath = fs.realpathSync(process.argv[1]);
const currentPath = fileURLToPath(import.meta.url);
if (nodePath === currentPath || nodePath.endsWith('generate-weekly-stats.ts') || nodePath.endsWith('generate-weekly-stats.js')) {
  generateWeeklyStats().catch(console.error);
}
