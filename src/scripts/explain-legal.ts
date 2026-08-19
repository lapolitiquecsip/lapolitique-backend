import 'dotenv/config';   // DOIT rester en 1er : charge .env AVANT l'import du client DeepSeek
                          // (son OpenAI() lit process.env.DEEPSEEK_API_KEY dès la construction).
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { resilientDeepSeek } from '../lib/deepseek-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Doit correspondre à la normalisation côté frontend (legal-explanations lookup).
function normalizeTitle(str: string): string {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

type Affair = { title: string; details: string };

// Découpe le champ legal_issues (blob texte) en affaires distinctes.
function parseAffairs(legalIssues: string | null): Affair[] {
  if (!legalIssues) return [];
  const low = legalIssues.toLowerCase();
  if (low.includes('aucune') || low.includes('casier vierge')) return [];
  return legalIssues
    .split('\n\n\n')
    .map(block => {
      const lines = block.split('\n').filter(Boolean);
      return { title: (lines[0] || '').trim(), details: lines.slice(1).join(' ').trim() };
    })
    .filter(a => a.title.length > 0);
}

const EXPLAIN_SYSTEM = `Tu es un journaliste judiciaire. On te donne le TITRE et les DÉTAILS (peines, infractions, année) d'une affaire judiciaire impliquant une personnalité politique française.

Ta tâche : expliquer CONCRÈTEMENT et FACTUELLEMENT en quoi consiste cette affaire précise — ce que la personne a fait ou ce qui lui est reproché, en 2 à 4 phrases simples et neutres, pour un citoyen non juriste.

RÈGLES STRICTES :
- Reste factuel et neutre, sans jugement moral ni sensationnalisme.
- Décris les FAITS de CETTE affaire précise (pas une définition générale de l'infraction).
- Si tu ne connais pas les faits précis de l'affaire, décris prudemment ce qui est reproché à partir du titre et de l'infraction, sans inventer de détails (noms, dates, montants) que tu ignores.
- Pas d'introduction ni de conclusion. Réponds uniquement par l'explication.`;

async function explainAffair(a: Affair): Promise<string | null> {
  const userMsg = `TITRE : ${a.title}\nDÉTAILS : ${a.details || '(non précisés)'}`;
  // deepseek-chat (non-raisonneur) : réponse complète et immédiate. Le modèle « flash »
  // raisonne et tronque parfois la sortie à max_tokens → explication vide. Repli sur flash
  // (gros plafond) si l'alias chat est un jour retiré.
  const attempts: Array<{ model: string; max_tokens: number; timeoutMs: number }> = [
    { model: 'deepseek-chat', max_tokens: 800, timeoutMs: 60000 },
    { model: 'deepseek-v4-flash', max_tokens: 4000, timeoutMs: 120000 },
  ];
  for (const at of attempts) {
    try {
      const response = await resilientDeepSeek.createMessage({
        model: at.model, max_tokens: at.max_tokens, system: EXPLAIN_SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }, { timeoutMs: at.timeoutMs });
      const text = response.content?.[0]?.text?.trim();
      if (text && text.length > 10) return text;
    } catch { /* tentative suivante */ }
  }
  return null;
}

async function main() {
  console.log('--- EXPLICATIONS DES AFFAIRES JUDICIAIRES ---');

  // 1) Rassemble toutes les affaires connues (députés, sénateurs, eurodéputés, candidats).
  const tables = ['deputies', 'senators', 'meps', 'presidential_candidates'];
  const affairsByKey = new Map<string, Affair>();
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('legal_issues');
    if (error) { console.log(`> (${table} indisponible: ${error.message})`); continue; }
    for (const row of data || []) {
      for (const a of parseAffairs((row as any).legal_issues)) {
        const key = normalizeTitle(a.title);
        if (key && !affairsByKey.has(key)) affairsByKey.set(key, a);
      }
    }
  }
  console.log(`> ${affairsByKey.size} affaires distinctes recensées.`);

  // 2) Ne (re)génère que celles qui manquent.
  const { data: existing } = await supabase.from('legal_case_explanations').select('case_key');
  const known = new Set((existing || []).map((r: any) => r.case_key));

  let generated = 0;
  for (const [key, affair] of affairsByKey) {
    if (known.has(key)) continue;
    try {
      const explanation = await explainAffair(affair);
      if (!explanation) { console.log(`> (vide) ${affair.title}`); continue; }
      const { error } = await supabase.from('legal_case_explanations').upsert({
        case_key: key, title: affair.title, explanation, updated_at: new Date().toISOString(),
      });
      if (error) { console.error(`> upsert ${affair.title}: ${error.message}`); continue; }
      generated++;
      console.log(`> ✓ ${affair.title}`);
    } catch (err: any) {
      console.error(`> échec ${affair.title}: ${err.message}`);
    }
  }

  console.log(`\n--- TERMINE. ${generated} explication(s) générée(s). ---`);
}

main().catch((e) => { console.error(e); process.exit(1); });
