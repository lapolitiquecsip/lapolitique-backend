import { supabase } from '../../config/supabase.js';
import { resilientDeepSeek } from '../../lib/deepseek-client.js';
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

  const prompt = `Expert du Parlement français. Génère 5 informations marquantes + 1 "Intox" hebdo.
Exigences : UTILES et NON-ÉVIDENTES (même pour connaisseurs), VARIÉES à chaque fois (ne répète pas les stats habituelles). Inclus au moins un fait lié au thème : "${randomTopic}". Date : ${currentDate}.
Évite les généralités ("le 49.3", "la présidente de l'AN"). Vise : chiffres techniques précis (taux d'amendements…), procédures méconnues, faits historiques rares, détails budgétaires/institutionnels pointus, données réelles de la 17e législature ou de l'histoire parlementaire.

Réponds UNIQUEMENT par le tableau JSON, sans texte avant/après. Exactement 5 faits (mélange "fact" chiffrés et "did-you-know") + 1 "intox". Couleurs = codes HEX VIFS et saturés (texte blanc lisible).
[
  { "type": "fact", "value": "chiffre", "label": "description courte avec le chiffre", "color": "#2563eb" },
  { "type": "did-you-know", "category_label": "LE SAVIEZ-VOUS ?", "content": "phrase marquante", "color": "#7c3aed" },
  { "type": "intox", "category_label": "INTOX DE LA SEMAINE", "content": "La fausse information entre guillemets", "debunk": "La réalité des faits", "color": "#dc2626" }
]`;


    // deepseek-v4-flash raisonne : le raisonnement consomme des tokens AVANT le JSON.
    // Un plafond trop bas (2000) tronque la sortie → « Pas de JSON trouvé ». Marge large.
    // deepseek-v4-flash « raisonne » : pour cette tâche créative ouverte, son raisonnement
    // (facturé en tokens de sortie, invisible dans le texte) déborde de façon non bornée et
    // tronque le JSON → « Pas de JSON trouvé ». On génère donc avec le modèle NON-raisonneur
    // (deepseek-chat) : sortie complète, immédiate, moins chère. Repli sur flash (gros plafond)
    // si l'alias chat finit par être retiré côté DeepSeek.
    const extractSlides = (raw: string): any[] | null => {
      const text = (raw || "").replace(/```json/gi, "").replace(/```/g, "");
      const m = text.match(/\[[\s\S]*\]/);              // tableau direct
      if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
      const o = text.match(/\{[\s\S]*\}/);              // objet { "slides": [...] }
      if (o) { try { const j = JSON.parse(o[0]); if (Array.isArray(j?.slides)) return j.slides; } catch { /* ignore */ } }
      return null;
    };

    const attempts: Array<{ model: string; max_tokens: number; timeoutMs: number }> = [
      { model: "deepseek-chat", max_tokens: 4000, timeoutMs: 90000 },        // non-raisonneur : fiable
      { model: "deepseek-v4-flash", max_tokens: 16000, timeoutMs: 180000 },  // repli si chat retiré
    ];
    let slides: any[] | null = null;
    for (const a of attempts) {
      try {
        const response = await resilientDeepSeek.createMessage({
          model: a.model, max_tokens: a.max_tokens, messages: [{ role: "user", content: prompt }],
        }, { timeoutMs: a.timeoutMs });
        const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
        slides = extractSlides(content);
        if (slides && slides.length) { console.log(`> Slides générées via ${a.model} (${slides.length}).`); break; }
        console.warn(`  ! ${a.model} : pas de JSON exploitable, tentative suivante…`);
      } catch (e: any) {
        console.warn(`  ! ${a.model} a échoué (${e.message}), tentative suivante…`);
      }
    }
    if (!slides || !slides.length) throw new Error("Pas de JSON trouvé dans la réponse");

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
