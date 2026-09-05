import { supabase } from '../../config/supabase.js';
import * as dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { parseFrenchDate } from './utils.js';
import { logError } from '../../lib/monitoring.js';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const ELYSEE_AGENDA_URL = 'https://www.elysee.fr/agenda';

function generateDeterministicUUID(input: string): string {
  const hash = crypto.createHash('sha1').update(input).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

// Explication FACTUELLE d'un événement = la méta description de sa page officielle
// (ex. « Le Président Emmanuel Macron s'est rendu à Eindhoven, aux Pays-Bas, ce 2 septembre 2026. »).
// Aucune IA, aucune interprétation : uniquement le texte publié par l'Élysée. null si indisponible.
async function fetchOgDescription(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const $ = cheerio.load(await res.text());
    const desc = ($('meta[property="og:description"]').attr('content')
      || $('meta[name="description"]').attr('content') || '').replace(/\s+/g, ' ').trim();
    return desc.length > 20 ? desc : null;
  } catch { return null; }
}

export async function main() {
  console.log('--- SYNC ELYSEE AGENDA ---');

  const hcId = process.env.HEALTHCHECK_ID_AGENDA;
  try {
    const response = await fetch(ELYSEE_AGENDA_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const $ = cheerio.load(html);

    // 1) Collecte SYNCHRONE des items (l'enrichissement réseau se fait ensuite).
    type Raw = { hour: string; type: string; title: string; links: string[]; eventUrl: string | null; sectionDate: string };
    const raw: Raw[] = [];

    $('section.container').each((i, section) => {
      // Date sticker usually contains: Day (text), Num (span), Month (span)
      const sticker = $(section).find('.sticker__content');
      if (!sticker.length) return;

      const dateParts: string[] = [];
      sticker.contents().each((_, node) => {
        const text = $(node).text().trim();
        if (text) dateParts.push(text);
      });

      const dateText = dateParts.join(' ');
      if (!dateText) return;

      const sectionDate = parseFrenchDate(`${dateText} ${new Date().getFullYear()}`);

      $(section).find('.list-table__content').each((j, item) => {
        const hour = $(item).find('.list-table__hour').text().trim();
        const type = $(item).find('.list-table__type').text().trim();
        const title = $(item).find('.m-b-n').text().trim();
        if (!title) return;

        // Capture links ; on retient le 1er lien DATÉ comme page propre de l'événement.
        const links: string[] = [];
        let eventUrl: string | null = null;
        $(item).next('.list-table__links').find('a').each((_, a) => {
          const linkText = $(a).text().trim();
          const href = $(a).attr('href');
          if (!href) return;
          const full = href.startsWith('http') ? href : 'https://www.elysee.fr' + href;
          links.push(`[${linkText}](${full})`);
          if (!eventUrl && /\/\d{4}\/\d{2}\/\d{2}\//.test(full)) eventUrl = full;
        });

        raw.push({ hour, type, title, links, eventUrl, sectionDate });
      });
    });

    // 2) Ignore le placeholder « L'agenda du Président est en cours de mise à jour. » (non-événement).
    const items = raw.filter(r => !/agenda du pr[ée]sident|en cours de mise [àa] jour/i.test(r.title));

    // 3) Enrichissement : la VRAIE date vient du lien daté de l'événement (le sticker « Mar 01 sept »
    //    ne sert que de repli) — fini les déplacements de plusieurs jours empilés sur « aujourd'hui ».
    //    L'explication factuelle = méta description de la page officielle.
    const events: any[] = [];
    for (const r of items) {
      const m = r.eventUrl?.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
      const isoDate = m ? `${m[1]}-${m[2]}-${m[3]}` : r.sectionDate;
      const short = r.eventUrl ? await fetchOgDescription(r.eventUrl) : null;

      const externalId = `elysee-${isoDate}-${r.hour}-${r.title.slice(0, 20)}`;
      const displayTitle = r.hour ? `[${r.hour}] ${r.title}` : r.title;

      events.push({
        id: generateDeterministicUUID(externalId),
        date: isoDate,
        title: displayTitle.length > 255 ? displayTitle.slice(0, 252) + '...' : displayTitle,
        short_summary: short,
        description: `${r.type}${r.links.length ? '\n\n' + r.links.join('\n') : ''}`,
        institution: 'Élysée',
        category: r.type || 'Agenda Présidentiel',
        source_url: r.eventUrl || ELYSEE_AGENDA_URL,
      });
    }

    console.log(`> Found ${events.length} items for Élysée agenda.`);

    let updatedCount = 0;
    for (const event of events) {
      const { error } = await supabase
        .from('events')
        .upsert(event, { onConflict: 'id' });
      if (!error) updatedCount++;
      else console.error(`Error for ${event.id}:`, error.message);
    }

    console.log(`\nTERMINE : ${updatedCount} événements de l'Élysée synchronisés.`);

  } catch (error: any) {
    await logError('fetchElyseeAgenda', error, hcId);
    throw error;
  }
}

const nodePath = fs.realpathSync(process.argv[1]);
const currentPath = fileURLToPath(import.meta.url);
if (nodePath === currentPath || nodePath.endsWith('fetch-elysee-agenda.ts') || nodePath.endsWith('fetch-elysee-agenda.js')) {
  main().catch(console.error);
}
