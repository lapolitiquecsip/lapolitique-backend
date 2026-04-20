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
