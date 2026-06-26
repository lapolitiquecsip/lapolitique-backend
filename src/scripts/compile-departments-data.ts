import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resilientDeepSeek } from '../lib/deepseek-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

// Complete list of all 101 departments from comparateur.ts
const DEPARTMENTS = [
  { "id": "01", "name": "Ain" },
  { "id": "02", "name": "Aisne" },
  { "id": "03", "name": "Allier" },
  { "id": "04", "name": "Alpes-de-Haute-Provence" },
  { "id": "05", "name": "Hautes-Alpes" },
  { "id": "06", "name": "Alpes-Maritimes" },
  { "id": "07", "name": "Ardèche" },
  { "id": "08", "name": "Ardennes" },
  { "id": "09", "name": "Ariège" },
  { "id": "10", "name": "Aube" },
  { "id": "11", "name": "Aude" },
  { "id": "12", "name": "Aveyron" },
  { "id": "13", "name": "Bouches-du-Rhône" },
  { "id": "14", "name": "Calvados" },
  { "id": "15", "name": "Cantal" },
  { "id": "16", "name": "Charente" },
  { "id": "17", "name": "Charente-Maritime" },
  { "id": "18", "name": "Cher" },
  { "id": "19", "name": "Corrèze" },
  { "id": "21", "name": "Côte-d'Or" },
  { "id": "22", "name": "Côtes-d'Armor" },
  { "id": "23", "name": "Creuse" },
  { "id": "24", "name": "Dordogne" },
  { "id": "25", "name": "Doubs" },
  { "id": "26", "name": "Drôme" },
  { "id": "27", "name": "Eure" },
  { "id": "28", "name": "Eure-et-Loir" },
  { "id": "29", "name": "Finistère" },
  { "id": "2A", "name": "Corse-du-Sud" },
  { "id": "2B", "name": "Haute-Corse" },
  { "id": "30", "name": "Gard" },
  { "id": "31", "name": "Haute-Garonne" },
  { "id": "32", "name": "Gers" },
  { "id": "33", "name": "Gironde" },
  { "id": "34", "name": "Hérault" },
  { "id": "35", "name": "Ille-et-Vilaine" },
  { "id": "36", "name": "Indre" },
  { "id": "37", "name": "Indre-et-Loire" },
  { "id": "38", "name": "Isère" },
  { "id": "39", "name": "Jura" },
  { "id": "40", "name": "Landes" },
  { "id": "41", "name": "Loir-et-Cher" },
  { "id": "42", "name": "Loire" },
  { "id": "43", "name": "Haute-Loire" },
  { "id": "44", "name": "Loire-Atlantique" },
  { "id": "45", "name": "Loiret" },
  { "id": "46", "name": "Lot" },
  { "id": "47", "name": "Lot-et-Garonne" },
  { "id": "48", "name": "Lozère" },
  { "id": "49", "name": "Maine-et-Loire" },
  { "id": "50", "name": "Manche" },
  { "id": "51", "name": "Marne" },
  { "id": "52", "name": "Haute-Marne" },
  { "id": "53", "name": "Mayenne" },
  { "id": "54", "name": "Meurthe-et-Moselle" },
  { "id": "55", "name": "Meuse" },
  { "id": "56", "name": "Morbihan" },
  { "id": "57", "name": "Moselle" },
  { "id": "58", "name": "Nièvre" },
  { "id": "59", "name": "Nord" },
  { "id": "60", "name": "Oise" },
  { "id": "61", "name": "Orne" },
  { "id": "62", "name": "Pas-de-Calais" },
  { "id": "63", "name": "Puy-de-Dôme" },
  { "id": "64", "name": "Pyrénées-Atlantiques" },
  { "id": "65", "name": "Hautes-Pyrénées" },
  { "id": "66", "name": "Pyrénées-Orientales" },
  { "id": "67", "name": "Bas-Rhin" },
  { "id": "68", "name": "Haut-Rhin" },
  { "id": "69", "name": "Rhône" },
  { "id": "70", "name": "Haute-Saône" },
  { "id": "71", "name": "Saône-et-Loire" },
  { "id": "72", "name": "Sarthe" },
  { "id": "73", "name": "Savoie" },
  { "id": "74", "name": "Haute-Savoie" },
  { "id": "75", "name": "Paris" },
  { "id": "76", "name": "Seine-Maritime" },
  { "id": "77", "name": "Seine-et-Marne" },
  { "id": "78", "name": "Yvelines" },
  { "id": "79", "name": "Deux-Sèvres" },
  { "id": "80", "name": "Somme" },
  { "id": "81", "name": "Tarn" },
  { "id": "82", "name": "Tarn-et-Garonne" },
  { "id": "83", "name": "Var" },
  { "id": "84", "name": "Vaucluse" },
  { "id": "85", "name": "Vendée" },
  { "id": "86", "name": "Vienne" },
  { "id": "87", "name": "Haute-Vienne" },
  { "id": "88", "name": "Vosges" },
  { "id": "89", "name": "Yonne" },
  { "id": "90", "name": "Territoire de Belfort" },
  { "id": "91", "name": "Essonne" },
  { "id": "92", "name": "Hauts-de-Seine" },
  { "id": "93", "name": "Seine-Saint-Denis" },
  { "id": "94", "name": "Val-de-Marne" },
  { "id": "95", "name": "Val-d'Oise" },
  { "id": "971", "name": "Guadeloupe" },
  { "id": "972", "name": "Martinique" },
  { "id": "973", "name": "Guyane" },
  { "id": "974", "name": "La Réunion" },
  { "id": "976", "name": "Mayotte" }
];

const BATCH_SIZE = 5;

async function fetchBatchIndicators(batch: { id: string, name: string }[]) {
  const prompt = `Vous êtes un expert en statistiques publiques françaises (INSEE, ministères). Votre mission est de fournir des indicateurs socio-démographiques officiels et précis (généralement pour l'année 2021 à 2023) pour les départements français suivants:
${JSON.stringify(batch, null, 2)}

Pour chaque département, vous devez fournir les indicateurs structurés exactement selon ce schéma JSON:
{
  "id": "code_insee_departement",
  "name": "nom_du_departement",
  "president": "nom_du_president_du_conseil_departemental_ou_unique",
  "party": "parti_politique_du_president",
  "demographie": {
    "populationTotal": nombre_entier, // population municipale légale récente
    "densite": nombre_entier, // hab/km²
    "evolution10ans": "pourcentage_string_avec_signe", // ex: "+3.2%" ou "-1.1%"
    "moins25ans": nombre_entier, // pourcentage entier (ex: 28)
    "plus65ans": nombre_entier // pourcentage entier (ex: 22)
  },
  "economie": {
    "chomage": nombre_decimal, // taux de chômage localisé 2023/2024
    "revenuMedian": nombre_entier, // revenu médian mensuel (Filosofi 2021 divisé par 12, ex: 1950, 2100, etc.)
    "pauvrete": nombre_entier // taux de pauvreté (%)
  },
  "education": {
    "bac": nombre_entier, // taux de réussite au bac (%)
    "diplomesSup": nombre_entier, // % diplômés du supérieur (%)
    "decrochage": nombre_entier // % décrochage scolaire (%)
  },
  "sante": {
    "medecins10k": nombre_entier, // densité de médecins pour 10 000 hab
    "scoreAPL": nombre_entier, // accessibilité potentielle localisée santé /100
    "esperanceVie": nombre_decimal // espérance de vie (ex: 82.5)
  },
  "securite": {
    "atteintesPersonnes": nombre_decimal, // crimes/violences physiques pour 1 000 hab
    "atteintesBiens": nombre_decimal // vols/dégradations pour 1 000 hab
  },
  "logement": {
    "prixM2": nombre_entier, // prix moyen/médian du m² en EUR
    "logementsSociaux": nombre_entier, // % logements sociaux (%)
    "proprietaires": nombre_entier // % propriétaires (%)
  },
  "finances": {
    "budgetHabitant": nombre_entier, // budget de fonctionnement par hab en EUR
    "endettement": nombre_entier, // taux d'endettement local (%)
    "investissement": nombre_entier // part d'investissement (%)
  },
  "environnement": {
    "qualiteAir": nombre_entier, // score de qualité de l'air /100
    "surfaceNaturelle": nombre_entier, // % espaces naturels ou agricoles (%)
    "risques": "faible" | "modéré" | "élevé"
  },
  "sources": "INSEE (Recensement 2021, Filosofi 2021), SSMSI (Sécurité 2023), DREES, DGCL/OFGL"
}

Consignes impératives :
1. Soyez extrêmement rigoureux sur l'exactitude des chiffres pour chaque département. Les données doivent correspondre aux ordres de grandeur réels officiels et connus des statistiques françaises.
2. Pour les départements d'outre-mer (Guadeloupe: 971, Martinique: 972, Guyane: 973, La Réunion: 974, Mayotte: 976) : utilisez leurs données réelles qui diffèrent fortement de la métropole (taux de chômage et pauvreté beaucoup plus élevés, population très jeune, etc.).
3. Renvoyez uniquement un tableau JSON valide contenant les objets structurés. Ne mettez aucun texte d'introduction ni de conclusion, pas de blocs de code markdown (comme \`\`\`json), juste le JSON pur.`;

  const response = await resilientDeepSeek.createMessage({
    model: 'deepseek-v4-flash',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  try {
    // Attempt to parse text directly or extract JSON array if markdown tags exist
    const jsonStr = text.substring(text.indexOf('['), text.lastIndexOf(']') + 1);
    const parsed = JSON.parse(jsonStr || text);
    return parsed;
  } catch (e: any) {
    console.error("Failed to parse DeepSeek response:", text);
    throw new Error(`JSON parsing failed: ${e.message}`);
  }
}

async function main() {
  console.log("🚀 Starting department statistics generation...");
  const results: Record<string, any> = {};

  for (let i = 0; i < DEPARTMENTS.length; i += BATCH_SIZE) {
    const batch = DEPARTMENTS.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(DEPARTMENTS.length / BATCH_SIZE)} (Departments ${batch[0].id} to ${batch[batch.length - 1].id})...`);
    
    let attempts = 0;
    let success = false;
    while (!success && attempts < 3) {
      try {
        attempts++;
        const batchData = await fetchBatchIndicators(batch);
        for (const dept of batchData) {
          results[dept.id] = dept;
        }
        success = true;
        console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} succeeded. Collected ${batchData.length} departments.`);
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

  const outputPath = path.join(dataDir, 'departments_indicators.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`🎉 Finished! Successfully generated statistics for ${Object.keys(results).length} departments and saved to ${outputPath}`);
}

main().catch(console.error);
