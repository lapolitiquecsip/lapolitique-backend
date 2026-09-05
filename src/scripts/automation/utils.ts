import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

// Télécharge + dézippe, avec timeout et reprises. Les serveurs open data (Assemblée, DILA…)
// renvoient régulièrement des 5xx/coupures transitoires : sans timeout la requête peut se figer
// (job CI annulé → échec), et sans reprise un simple blip fait planter tout le workflow.
export async function downloadAndUnzip(
  url: string,
  targetDir: string,
  opts: { retries?: number; timeoutMs?: number } = {},
) {
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 60000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`> Downloading ${url}${attempt > 1 ? ` (tentative ${attempt}/${retries})` : ""}...`);
      const response = await fetch(url, {
        headers: { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      const buffer = await response.arrayBuffer();
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      const tempZip = path.join(targetDir, 'temp.zip');
      fs.writeFileSync(tempZip, Buffer.from(buffer));
      console.log(`> Unzipping to ${targetDir}...`);
      const zip = new AdmZip(tempZip);
      zip.extractAllTo(targetDir, true);
      fs.unlinkSync(tempZip);
      console.log(`> Done.`);
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`  ! téléchargement échoué (${(e as Error).message})`);
      if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

const deaccent = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const MONTHS: [string, string][] = [
  ['janvier', '01'], ['fevrier', '02'], ['mars', '03'], ['avril', '04'], ['mai', '05'], ['juin', '06'],
  ['juillet', '07'], ['aout', '08'], ['septembre', '09'], ['octobre', '10'], ['novembre', '11'], ['decembre', '12'],
];
// Reconnaît un mois depuis une abréviation quelconque, traitée comme préfixe du nom complet
// (« sept »→09, « fév »→02, « juil »→07…). Robuste aux abréviations variables (elysee : « sept »).
function monthFromPart(part: string): string | undefined {
  const p = deaccent(part).replace(/\.$/, '');
  return p.length >= 3 ? MONTHS.find(([name]) => name.startsWith(p))?.[1] : undefined;
}

export function parseFrenchDate(dateStr: string): string {

  // Replace non-breaking spaces and multiple spaces with a single space, then split
  const normalizedStr = dateStr.toLowerCase().replace(/\s+/g, ' ').replace(/\u00A0/g, ' ');
  const parts = normalizedStr.split(' ');
  
  // Handle "Mardi 28 avril 2026" or "1er avril 2026"
  // First, remove days of the week to avoid confusion (e.g. "mar" for mardi vs "mar" for mars)
  const daysOfWeek = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  
  // We need to be careful not to remove 'mar' if it's actually the month.
  // Usually the format is "DayOfWeek Day Number Month Year".
  // So the day of week is the FIRST part. Let's just skip the first part if it's a day of the week.
  if (daysOfWeek.includes(deaccent(parts[0]))) {
    parts.shift();
  }

  // Extract just the digits for the day
  const dayMatch = parts.find(p => /^\d+(er)?$/.test(p));
  const day = dayMatch ? dayMatch.replace('er', '').padStart(2, '0') : null;

  const month = parts.map(monthFromPart).find(Boolean);
  const year = parts.find(p => /^\d{4}$/.test(p));

  if (day && month && year) {
    return `${year}-${month}-${day}`;
  }
  
  console.log(`Failed to parse date: "${dateStr}" (normalized: "${normalizedStr}")`);
  return new Date().toISOString().split('T')[0];
}
