import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// Top 20 communes from local/page.tsx
const COMMUNES = [
  { name: "Paris", code: "75056", mayor: "Anne Hidalgo", party: "PS" },
  { name: "Marseille", code: "13055", mayor: "Benoît Payan", party: "DVG" },
  { name: "Lyon", code: "69123", mayor: "Grégory Doucet", party: "EELV" },
  { name: "Toulouse", code: "31555", mayor: "Jean-Luc Moudenc", party: "LR" },
  { name: "Nice", code: "06088", mayor: "Christian Estrosi", party: "HOR" },
  { name: "Nantes", code: "44109", mayor: "Johanna Rolland", party: "PS" },
  { name: "Montpellier", code: "34172", mayor: "Michaël Delafosse", party: "PS" },
  { name: "Strasbourg", code: "67482", mayor: "Jeanne Barseghian", party: "EELV" },
  { name: "Bordeaux", code: "33063", mayor: "Pierre Hurmic", party: "EELV" },
  { name: "Lille", code: "59350", mayor: "Martine Aubry", party: "PS" },
  { name: "Rennes", code: "35238", mayor: "Nathalie Appéré", party: "PS" },
  { name: "Reims", code: "51454", mayor: "Arnaud Robinet", party: "HOR" },
  { name: "Toulon", code: "83137", mayor: "Josée Massi", party: "LR" },
  { name: "Saint-Étienne", code: "42218", mayor: "Gaël Perdriau", party: "DVD" },
  { name: "Le Havre", code: "76351", mayor: "Édouard Philippe", party: "HOR" },
  { name: "Grenoble", code: "38185", mayor: "Éric Piolle", party: "EELV" },
  { name: "Dijon", code: "21231", mayor: "François Rebsamen", party: "PS" },
  { name: "Angers", code: "49007", mayor: "Jean-Marc Verchère", party: "HOR" },
  { name: "Nîmes", code: "30189", mayor: "Jean-Paul Fournier", party: "LR" },
  { name: "Villeurbanne", code: "69266", mayor: "Cédric Van Styvendael", party: "PS" }
];

const BATCH_SIZE = 5;

async function fetchBatchIndicators(batch: { name: string, code: string, mayor: string, party: string }[]) {
  const prompt = `Vous êtes un expert en statistiques publiques locales françaises (INSEE, DGCL, OFGL, Ministère de l'Intérieur). Votre mission est de fournir des indicateurs officiels, réels, et 100% exacts (pour les années récentes 2021 à 2024) pour les communes françaises suivantes :
${JSON.stringify(batch, null, 2)}

Pour chaque commune, vous devez fournir les indicateurs structurés exactement selon ce schéma JSON:
{
  "code": "code_insee_commune",
  "name": "nom_de_la_commune",
  "mayor": "nom_du_maire",
  "party": "parti_du_maire",
  "demographie": {
    "populationTotal": nombre_entier, // Population municipale légale de la commune
    "densite": nombre_entier, // hab/km²
    "evolution10ans": "pourcentage_string_avec_signe", // ex: "+2.5%" ou "-1.2%"
    "moins25ans": nombre_entier, // % de moins de 25 ans (%)
    "plus65ans": nombre_entier // % de 65 ans et plus (%)
  },
  "economie": {
    "chomage": nombre_decimal, // Taux de chômage local (%)
    "revenuMedian": nombre_entier, // Revenu médian mensuel (Filosofi divisé par 12)
    "pauvrete": nombre_entier // Taux de pauvreté (%)
  },
  "logement": {
    "prixM2": nombre_entier, // Prix moyen du m² d'habitation en EUR
    "logementsSociaux": nombre_entier, // Part des logements sociaux (%)
    "proprietaires": nombre_entier // Part des ménages propriétaires (%)
  },
  "finances": {
    "budgetHabitant": nombre_entier, // Budget de fonctionnement municipal par habitant en EUR
    "endettement": nombre_entier, // Taux d'endettement municipal (%)
    "investissement": nombre_entier // Part de l'investissement dans le budget (%)
  },
  "fiscalite": {
    "tauxTF": nombre_decimal, // Taux communal de la taxe foncière sur les propriétés bâties (%)
    "tauxTH": nombre_decimal // Taux communal de la taxe d'habitation sur les résidences secondaires (%)
  },
  "securite": {
    "atteintesPersonnes": nombre_decimal, // Violences physiques pour 1 000 hab. (SSMSI récent)
    "atteintesBiens": nombre_decimal // Vols et dégradations pour 1 000 hab.
  },
  "sante": {
    "medecins10k": nombre_entier, // Nombre de médecins pour 10 000 habitants
    "scoreAPL": nombre_entier, // Accessibilité Potentielle Localisée aux soins /100
    "esperanceVie": nombre_decimal // Espérance de vie moyenne
  },
  "education": {
    "bac": nombre_entier, // Taux de réussite au bac des lycées de la ville (%)
    "diplomesSup": nombre_entier, // % diplômés du supérieur (%)
    "decrochage": nombre_entier // % décrochage scolaire (%)
  },
  "environnement": {
    "qualiteAir": nombre_entier, // Score qualité de l'air de la ville /100
    "surfaceNaturelle": nombre_entier, // % espaces verts ou agricoles (%)
    "risques": "faible" | "modéré" | "élevé"
  },
  "sources": "INSEE (Recensement 2021, Filosofi 2021), DGCL/OFGL (Finances & Fiscalité 2023/2024), Ministère de l'Intérieur/SSMSI (Sécurité 2023), DREES (Santé)"
}

Consignes impératives :
1. Soyez extrêmement rigoureux sur l'exactitude des chiffres pour chaque ville. Par exemple, le budget de fonctionnement par habitant et le taux de taxe foncière (taux TF) doivent correspondre précisément aux valeurs réelles publiées par l'OFGL / DGCL pour l'année 2023/2024. Le prix moyen du m² doit refléter le marché récent de chaque ville (ex: plus de 9000 €/m² à Paris, environ 4000 €/m² à Lyon, etc.).
2. Renvoyez uniquement un tableau JSON valide contenant les objets structurés. Ne mettez aucun texte d'introduction ni de conclusion, pas de blocs de code markdown (comme \`\`\`json), juste le JSON pur.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (response.content[0] as any).text;
  try {
    const jsonStr = text.substring(text.indexOf('['), text.lastIndexOf(']') + 1);
    const parsed = JSON.parse(jsonStr || text);
    return parsed;
  } catch (e: any) {
    console.error("Failed to parse Claude response:", text);
    throw new Error(`JSON parsing failed: ${e.message}`);
  }
}

async function main() {
  console.log("🚀 Starting commune statistics compilation...");
  const results: Record<string, any> = {};

  for (let i = 0; i < COMMUNES.length; i += BATCH_SIZE) {
    const batch = COMMUNES.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(COMMUNES.length / BATCH_SIZE)} (Communes: ${batch.map(c => c.name).join(', ')})...`);
    
    let attempts = 0;
    let success = false;
    while (!success && attempts < 3) {
      try {
        attempts++;
        const batchData = await fetchBatchIndicators(batch);
        for (const commune of batchData) {
          results[commune.code] = commune;
        }
        success = true;
        console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} succeeded. Collected ${batchData.length} communes.`);
      } catch (err: any) {
        console.warn(`⚠️ Attempt ${attempts} failed: ${err.message}. Retrying in 5 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    if (!success) {
      throw new Error(`Fatal: Failed to generate data for batch starting at index ${i}`);
    }
  }

  // Ensure directories exist
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const outputPath = path.join(dataDir, 'communes_indicators.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`🎉 Finished! Successfully compiled statistics for ${Object.keys(results).length} communes and saved to ${outputPath}`);
}

main().catch(console.error);
