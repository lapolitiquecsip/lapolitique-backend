import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import AdmZip from "adm-zip";
import { buildOfficialTerritory, type OddRow } from "../lib/territorial-indicators.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDirectory = path.join(root, "data/official-local");
const sourceUrl = "https://www.insee.fr/fr/statistiques/fichier/4505239/ODD_CSV.zip";

async function ensureSources() {
  const expected = ["ODD_DEP.csv", "ODD_REG.csv"];
  if (expected.every(file => fs.existsSync(path.join(sourceDirectory, file)))) return;
  fs.mkdirSync(sourceDirectory, { recursive: true });
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok) throw new Error(`Insee ITDD download failed: HTTP ${response.status}`);
  const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
  for (const file of expected) {
    const entry = zip.getEntry(file);
    if (!entry) throw new Error(`Missing ${file} in Insee ITDD archive`);
    fs.writeFileSync(path.join(sourceDirectory, file), entry.getData());
  }
}

await ensureSources();

for (const [source, destination] of [["ODD_DEP.csv", "departments_indicators.json"], ["ODD_REG.csv", "regions_indicators.json"]] as const) {
  const rows = parse(fs.readFileSync(path.join(sourceDirectory, source), "utf8"), { columns: true, delimiter: ";", bom: true, skip_empty_lines: true }) as OddRow[];
  const grouped = Map.groupBy(rows, row => row.codgeo);
  const output = Object.fromEntries([...grouped].map(([code, territoryRows]) => [code, buildOfficialTerritory(territoryRows)]));
  fs.writeFileSync(path.join(root, `src/data/${destination}`), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`${destination}: ${Object.keys(output).length} official territories compiled.`);
}
