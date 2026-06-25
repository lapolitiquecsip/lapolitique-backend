import fs from 'fs';
import path from 'path';
import readline from 'readline';

export interface EluMunicipal {
  nom: string;
  prenom: string;
  sexe: string;
  dateNaissance: string;
  categoriePro: string;
  dateDebutMandat: string;
  fonction: string;
}

// Memory cache for commune élus
const elusCache = new Map<string, EluMunicipal[]>();
let isLoaded = false;
let isLoading = false;

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ';' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export async function loadRneDatabase() {
  if (isLoaded || isLoading) return;
  isLoading = true;
  console.log("⏳ Loading RNE municipal elected officials database into memory...");
  
  const csvPath = path.resolve(process.cwd(), 'data/elus-conseillers-municipaux-cm.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`⚠️ RNE CSV file not found at ${csvPath}`);
    isLoading = false;
    return;
  }

  const startTime = Date.now();
  const fileStream = fs.createReadStream(csvPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  for await (const line of rl) {
    lineCount++;
    if (lineCount === 1) continue; // Skip header
    const cols = parseCsvLine(line.replace(/\r$/, ''));
    if (cols.length < 14) continue;

    const dep = cols[0];
    const com = cols[4];
    let insee = com;
    if (com.length < 5) {
      const depCode = dep.padStart(2, '0');
      const comCode = com.padStart(3, '0').slice(-3);
      insee = depCode + comCode;
    }

    const elu: EluMunicipal = {
      nom: cols[6],
      prenom: cols[7],
      sexe: cols[8],
      dateNaissance: cols[9],
      categoriePro: cols[11],
      dateDebutMandat: cols[12],
      fonction: cols[13]
    };

    let list = elusCache.get(insee);
    if (!list) {
      list = [];
      elusCache.set(insee, list);
    }
    list.push(elu);
  }

  isLoaded = true;
  isLoading = false;
  console.log(`✅ Loaded RNE database in ${((Date.now() - startTime) / 1000).toFixed(2)}s. Cached ${elusCache.size} communes.`);
}

export async function getElusForCommune(codeInsee: string): Promise<EluMunicipal[] | null> {
  if (!isLoaded) {
    await loadRneDatabase();
  }
  return elusCache.get(codeInsee) || null;
}
