import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

export async function downloadAndUnzip(url: string, targetDir: string) {
  console.log(`> Downloading ${url}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
  
  const buffer = await response.arrayBuffer();
  const tempZip = path.join(targetDir, 'temp.zip');
  
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  
  fs.writeFileSync(tempZip, Buffer.from(buffer));
  
  console.log(`> Unzipping to ${targetDir}...`);
  const zip = new AdmZip(tempZip);
  zip.extractAllTo(targetDir, true);
  
  fs.unlinkSync(tempZip);
  console.log(`> Done.`);
}

export function parseFrenchDate(dateStr: string): string {
  const months: Record<string, string> = {
    'janvier': '01', 'jan': '01',
    'février': '02', 'fév': '02',
    'mars': '03', 'mar': '03',
    'avril': '04', 'avr': '04',
    'mai': '05',
    'juin': '06', 'jui': '06',
    'juillet': '07', 'juil': '07',
    'août': '08', 'aoû': '08',
    'septembre': '09', 'sep': '09',
    'octobre': '10', 'oct': '10',
    'novembre': '11', 'nov': '11',
    'décembre': '12', 'déc': '12'
  };

  const parts = dateStr.toLowerCase().split(' ');
  // Handle "Mardi 28 avril 2026" or "28 avril 2026"
  const day = parts.find(p => /^\d+$/.test(p))?.padStart(2, '0');
  const month = months[parts.find(p => months[p]) || ''];
  const year = parts.find(p => /^\d{4}$/.test(p));

  if (day && month && year) {
    return `${year}-${month}-${day}`;
  }
  
  return new Date().toISOString().split('T')[0];
}
