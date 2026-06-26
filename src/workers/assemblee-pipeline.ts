import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { supabase } from '../config/supabase.js';
import * as Sentry from '@sentry/node';
import { logStart, logSuccess, logError } from '../lib/monitoring.js';
import { resilientDeepSeek } from '../lib/deepseek-client.js';

const parser = new Parser({
  customFields: {
    item: [['content:encoded', 'contentEncoded']]
  }
});

// ---------------------------------------------------------------------------
// Sources configuration
// Add / remove feeds here without touching the pipeline logic.
// maxItems = max new items processed per run per source (avoids DB flood).
// ---------------------------------------------------------------------------
interface Source {
  url: string;
  institution: string;
  defaultSourceName: string;
  maxItems: number;
}

const SOURCES: Source[] = [
  // ── Institutions ─────────────────────────────────────────────────────────
  {
    url: 'https://www.assemblee-nationale.fr/dyn/rss/comptes-rendus.rss',
    institution: 'assemblée',
    defaultSourceName: 'Assemblée Nationale',
    maxItems: 5,
  },
  {
    url: 'https://www.senat.fr/rss/presse.rss',
    institution: 'sénat',
    defaultSourceName: 'Sénat',
    maxItems: 3,
  },
  {
    url: 'https://www.senat.fr/rss/rapports.rss',
    institution: 'sénat',
    defaultSourceName: 'Sénat',
    maxItems: 3,
  },
  {
    url: 'https://www.senat.fr/rss/textes.rss',
    institution: 'sénat',
    defaultSourceName: 'Sénat',
    maxItems: 2,
  },
  {
    url: 'https://www.lecese.fr/rss/flux/article',
    institution: 'cese',
    defaultSourceName: 'CESE',
    maxItems: 3,
  },
  {
    url: 'https://www.vie-publique.fr/actualites-feeds.xml',
    institution: 'vie-publique',
    defaultSourceName: 'Vie Publique',
    maxItems: 3,
  },
  {
    url: 'https://www.vie-publique.fr/lois-feeds.xml',
    institution: 'vie-publique',
    defaultSourceName: 'Vie Publique',
    maxItems: 2,
  },
  {
    url: 'https://www.vie-publique.fr/rapports-feeds.xml',
    institution: 'vie-publique',
    defaultSourceName: 'Vie Publique',
    maxItems: 2,
  },
  // ── Médias ───────────────────────────────────────────────────────────────
  {
    url: 'https://www.lemonde.fr/politique/rss_full.xml',
    institution: 'média',
    defaultSourceName: 'Le Monde',
    maxItems: 3,
  },
  {
    url: 'https://www.lefigaro.fr/rss/figaro_politique.xml',
    institution: 'média',
    defaultSourceName: 'Le Figaro',
    maxItems: 3,
  },
  {
    url: 'https://www.francetvinfo.fr/politique.rss',
    institution: 'média',
    defaultSourceName: 'France Info',
    maxItems: 3,
  },
  {
    url: 'https://services.lesechos.fr/rss/les-echos-politique.xml',
    institution: 'média',
    defaultSourceName: 'Les Échos',
    maxItems: 3,
  },
  {
    url: 'https://www.liberation.fr/arc/outboundfeeds/rss/category/politique/?outputType=xml',
    institution: 'média',
    defaultSourceName: 'Libération',
    maxItems: 3,
  },
  {
    url: 'https://www.politico.eu/feed',
    institution: 'média',
    defaultSourceName: 'Politico',
    maxItems: 2,
  },
];

// ---------------------------------------------------------------------------
// Content extraction: use RSS body first, fall back to URL scrape.
// Handles paywalled media gracefully.
// ---------------------------------------------------------------------------
async function extractContent(item: any, sourceUrl: string): Promise<string> {
  // 1. Full content in RSS item (e.g. lemonde rss_full.xml)
  const rssBody: string = (item as any).contentEncoded || item.content || '';
  if (rssBody.length > 400) {
    const $ = cheerio.load(rssBody);
    return $.text().replace(/\s+/g, ' ').trim();
  }

  // 2. Scrape the article URL
  try {
    const res = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, aside, .sidebar, .pub, .cookie-banner').remove();
    const main = $('article').length
      ? $('article').text()
      : $('main').length
      ? $('main').text()
      : $('body').text();
    return main.replace(/\s+/g, ' ').trim();
  } catch {
    // 3. Last resort: title + RSS summary
    return `${item.title || ''} ${item.summary || item.contentSnippet || ''}`.replace(/\s+/g, ' ').trim();
  }
}

// ---------------------------------------------------------------------------
// DeepSeek summarisation
// ---------------------------------------------------------------------------
async function summarise(cleanedText: string, institution: string) {
  const isMedia = institution === 'média';

  const response = await resilientDeepSeek.createMessage({
    model: 'deepseek-v4-flash',
    max_tokens: 1200,
    system: `Tu es un journaliste politique expert qui alimente un fil d'actu addictif pour des citoyens français curieux.

TON OBJECTIF : chaque carte doit apprendre quelque chose de CONCRET à l'utilisateur. Pas de vague, pas de généralités.
${isMedia ? "Le texte peut être en anglais : résume toujours en FRANÇAIS." : ""}

RÈGLES ABSOLUES :
1. "titre_simplifie" (max 12 mots) : accrocheur, factuel. Commence par un chiffre, une conséquence concrète, ou une question qui interpelle. JAMAIS juste "Rapport X publié" ou "Examen du projet Y".
   Exemples BONS : "Les retraites anticipées coûtent 3,8 Mds€ par an" / "Loyers parisiens : +7% en 2025, pourquoi ?" / "La loi agricole supprime 12 000 contrôles par an"
   Exemples MAUVAIS : "Publication du rapport Bruneau" / "Examen de la loi de finances" / "Suite de l'ordre du jour"

2. "resume_flash" (2-3 phrases, 60 mots max) : TOUJOURS inclure au moins 1 chiffre ou fait concret extrait du texte (budget en euros, nombre de personnes, pourcentage, délai...). Expliquer l'impact réel sur les citoyens. Rédiger comme un journaliste de terrain.

3. "resume_detaille" (6-10 phrases) : contexte complet, enjeux, chiffres clés, positions politiques, conséquences pratiques pour les Français.

4. "should_publish" (boolean) : mettre FALSE uniquement si le texte ne contient AUCUNE information utile (dépôt administratif pur, agenda vide, procédure sans contenu). Dans tous les autres cas, TRUE.

5. "source_name" (string) : liste les sources journalistiques ou institutionnelles citées dans le texte, séparées par des virgules. Si aucune source externe, utilise le nom de l'institution émettrice.

Réponds UNIQUEMENT avec un objet JSON valide (sans bloc markdown) :
{
  "titre_simplifie": "...",
  "resume_flash": "...",
  "resume_detaille": "...",
  "should_publish": true,
  "source_name": "..."
}`,
    messages: [
      {
        role: 'user',
        content: `Transforme ce contenu en information citoyenne percutante :\n\n${cleanedText.substring(0, 15000)}`,
      },
    ],
  });

  let text = response.content[0].text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```json?\n?/, '').replace(/```$/, '').trim();
  }
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Process a single RSS source
// ---------------------------------------------------------------------------
async function processSource(
  source: Source,
  totalProcessed: { count: number; errors: number }
) {
  console.log(`\n[Pipeline] ▶ ${source.defaultSourceName} (${source.url})`);
  let feed;
  try {
    feed = await parser.parseURL(source.url);
  } catch (err: any) {
    console.error(`[Pipeline] ✗ Failed to parse RSS for ${source.defaultSourceName}: ${err.message}`);
    return;
  }

  let processedThisSource = 0;

  for (const item of feed.items) {
    if (processedThisSource >= source.maxItems) break;

    const sourceUrl = item.link;
    if (!sourceUrl) continue;

    // Deduplication
    const { data: existing } = await supabase
      .from('content')
      .select('id')
      .eq('source_url', sourceUrl)
      .single();
    if (existing) continue;

    try {
      const cleanedText = await extractContent(item, sourceUrl);

      if (cleanedText.length < 150) {
        console.log(`[Pipeline] ⚠ Too short, skipping: ${sourceUrl}`);
        continue;
      }

      const summary = await summarise(cleanedText, source.institution);

      if (summary.should_publish === false) {
        console.log(`[Pipeline] ⊘ Low-value, skipped: ${item.title}`);
        continue;
      }

      const { error: insertError } = await supabase.from('content').insert({
        titre_original: item.title || 'Sans titre',
        titre_simplifie: summary.titre_simplifie,
        resume_flash: summary.resume_flash,
        resume_detaille: summary.resume_detaille,
        source_url: sourceUrl,
        source_name: summary.source_name || source.defaultSourceName,
        institution: source.institution,
        date_publication: item.pubDate
          ? new Date(item.pubDate).toISOString()
          : new Date().toISOString(),
        date_traitement: new Date().toISOString(),
        raw_text: cleanedText.substring(0, 5000),
        status: 'published',
      });

      if (insertError) throw insertError;

      console.log(`[Pipeline] ✓ ${summary.titre_simplifie}`);
      processedThisSource++;
      totalProcessed.count++;

      // Small delay between items to respect rate limits
      await new Promise(r => setTimeout(r, 800));

    } catch (err: any) {
      console.error(`[Pipeline] ✗ Error on ${sourceUrl}:`, err.message);
      Sentry.captureException(err, {
        tags: { component: 'content-pipeline', source: source.defaultSourceName },
      });
      totalProcessed.errors++;
    }
  }

  console.log(`[Pipeline] ${source.defaultSourceName}: ${processedThisSource} new items.`);
}

// ---------------------------------------------------------------------------
// Main export — called by workers/index.ts every 120 min
// ---------------------------------------------------------------------------
export async function runAssembleePipeline() {
  console.log(`\n[Pipeline] ══ Starting multi-source content pipeline at ${new Date().toISOString()} ══`);
  const hcId = process.env.HEALTHCHECK_ID_ASSEMBLEE;
  await logStart('assembleePipeline', hcId);

  const totals = { count: 0, errors: 0 };

  try {
    for (const source of SOURCES) {
      await processSource(source, totals);
    }

    console.log(`\n[Pipeline] ══ Done. Total: ${totals.count} inserted, ${totals.errors} errors ══`);
    await logSuccess('assembleePipeline', totals.count, hcId,
      `${totals.count} items inserted across ${SOURCES.length} sources, ${totals.errors} errors.`);

    return { processed: totals.count, errors: totals.errors, status: 'success' };

  } catch (err: any) {
    await logError('assembleePipeline', err, hcId);
    throw err;
  }
}
