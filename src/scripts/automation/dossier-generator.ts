import { supabase } from '../../config/supabase.js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { logStart, logSuccess, logError } from '../../lib/monitoring.js';
import { resilientDeepSeek } from '../../lib/deepseek-client.js';

dotenv.config();

const CATEGORIES = [
  "Économie",
  "Social",
  "Santé",
  "Éducation",
  "Environnement",
  "Sécurité"
];

export async function generateDossiers() {
  console.log("=== Lancement de la génération des Dossiers Premium ===");

  const hcId = process.env.HEALTHCHECK_ID_DOSSIERS;
  await logStart('generateDossiers', hcId);

  let insertedCount = 0;

  try {
    // 1. Fetch scrutins that are LOI and adopted, which don't have a matching dossier in 'laws'
  const { data: scrutins, error: fetchError } = await supabase
    .from('scrutins')
    .select('*')
    .eq('type', 'LOI')
    .ilike('resultat', '%adopté%')
    .order('date_scrutin', { ascending: false })
    .limit(30);

  if (fetchError || !scrutins) {
    console.error("Erreur récupération scrutins:", fetchError);
    return;
  }

  console.log(`Trouvé ${scrutins.length} lois adoptées potentielles.`);

  for (const scrutin of scrutins) {
    // Check if we already created a dossier for this scrutin using context
    const { data: existingLaw } = await supabase
      .from('laws')
      .select('id')
      .eq('context', `dossier_premium:${scrutin.id}`)
      .limit(1)
      .single();

    if (existingLaw) {
      console.log(`[SKIP] Dossier existant pour : ${scrutin.objet}`);
      continue;
    }

    console.log(`[GENERATION] Création du dossier pour : ${scrutin.objet}`);

    const prompt = `
Tu es un expert juridique et politique français.
Ta mission est de créer un dossier d'analyse extrêmement détaillé pour une loi qui a été définitivement adoptée par le Parlement.

Voici la loi :
Titre : ${scrutin.objet}
Date de vote : ${scrutin.date_scrutin}
Résumé existant : ${scrutin.summary || "N/A"}
Enjeux existants : ${scrutin.why_it_matters || "N/A"}

Tu dois générer un JSON valide (AUCUN texte avant ou après, JUSTE le JSON) avec la structure exacte suivante :
{
  "title": "Titre court et intuitif (ex: 'Soutien à l'innovation thérapeutique contre les cancers de l'enfant' au lieu de 'l'ensemble de la proposition de loi visant à mettre en place...'). Il doit tenir sur une ligne.",
  "category": "Une SEULE catégorie parmi : ${CATEGORIES.join(", ")}",
  "color": "Une couleur parmi : emerald, blue, slate, red",
  "summary": "Un résumé pédagogique mais très complet de 3-4 phrases sur la loi et ce qu'elle change pour les citoyens.",
  "impacts": [
    "Impact direct 1",
    "Impact direct 2",
    "Impact direct 3"
  ],
  "premium_points": [
    "Décryptage pointu ou technique 1",
    "Décryptage pointu ou technique 2",
    "Décryptage pointu ou technique 3",
    "Décryptage pointu ou technique 4"
  ],
  "calendar": [
    { "date": "Date courte (ex: Janv 2024)", "event": "Événement législatif (ex: Promulgation)" },
    { "date": "Date courte", "event": "Événement" },
    { "date": "Date courte", "event": "Événement futur ou passé" }
  ]
}

Choisis une 'color' pertinente par rapport au thème (ex: emerald pour Environnement, blue pour Économie/Social, red pour Santé/Sécurité, slate pour Éducation/Défense).
Sois précis, concret, et fournis de véritables chiffres ou faits concrets si possible.
`;

    try {
      const msg = await resilientDeepSeek.createMessage({
        model: "deepseek-chat",
        max_tokens: 2500,
        system: "Tu es un expert politique qui génères des JSON valides.",
        messages: [{ role: "user", content: prompt }]
      });

      const responseText = msg.content[0].text.trim();
      const jsonStart = responseText.indexOf('{');
      const jsonEnd = responseText.lastIndexOf('}');
      const jsonStr = responseText.substring(jsonStart, jsonEnd + 1);

      const parsed = JSON.parse(jsonStr);

      const lawData = {
        title: parsed.title || scrutin.objet,
        summary: parsed.summary,
        context: `dossier_premium:${scrutin.id}`, // Link to original scrutin for votes
        impact: JSON.stringify(parsed.impacts),
        content: JSON.stringify(parsed.premium_points),
        timeline: parsed.calendar,
        category: parsed.category,
        date_adopted: scrutin.date_scrutin,
        vote_result: scrutin.resultat
        // background_image could be added later if needed
      };

      const { error: insertError } = await supabase
        .from('laws')
        .insert([lawData]);

      if (insertError) {
        console.error(`Erreur d'insertion pour ${scrutin.objet}:`, insertError);
      } else {
        console.log(`[SUCCÈS] Dossier créé avec succès !`);
        insertedCount++;
      }

    } catch (err: any) {
      console.error(`Erreur avec DeepSeek pour ${scrutin.objet}:`, err);
      // Capture non-blocking individual DeepSeek failure in Sentry
      import('@sentry/node').then(Sentry => {
        Sentry.captureException(err, { tags: { scrutin: scrutin.id, component: 'dossier-generator' } });
      });
    }
    
    // Pause pour éviter les rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log("=== Terminé ===");
  await logSuccess('generateDossiers', insertedCount, hcId, `Generated ${insertedCount} premium dossiers.`);

  } catch (err: any) {
    await logError('generateDossiers', err, hcId);
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateDossiers();
}
