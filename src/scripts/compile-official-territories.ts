import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import AdmZip from "adm-zip";
import { buildCommunePopulations, buildOfficialTerritory, buildRegionalFinances, type OddRow, type RegionalBudgetRecord } from "../lib/territorial-indicators.js";

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

const populationArchive = path.join(sourceDirectory, "population-reference-2023.zip");
const communesPopulationFile = path.join(sourceDirectory, "donnees_communes.csv");
if (!fs.existsSync(communesPopulationFile)) {
  const response = await fetch("https://www.insee.fr/fr/statistiques/fichier/8680726/ensemble.zip", { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Insee population download failed: HTTP ${response.status}`);
  fs.writeFileSync(populationArchive, Buffer.from(await response.arrayBuffer()));
  const entry = new AdmZip(populationArchive).getEntry("donnees_communes.csv");
  if (!entry) throw new Error("Missing donnees_communes.csv in Insee population archive");
  fs.writeFileSync(communesPopulationFile, entry.getData());
}

const budgetWhere = encodeURIComponent(`exer=date'2024' and type_de_budget="Budget principal" and (agregat="Dépenses de fonctionnement" or agregat="Dépenses d'investissement hors remb" or agregat="Encours de dette" or agregat="Recettes de fonctionnement")`);
const budgetResponse = await fetch(`https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/ofgl-base-regions/records?where=${budgetWhere}&limit=100`, { signal: AbortSignal.timeout(30_000) });
if (!budgetResponse.ok) throw new Error(`OFGL regional accounts failed: HTTP ${budgetResponse.status}`);
const budgetRecords = ((await budgetResponse.json()) as { results: RegionalBudgetRecord[] }).results;
const budgetsByRegion = Map.groupBy(budgetRecords, record => record.reg_code);

for (const [source, destination] of [["ODD_DEP.csv", "departments_indicators.json"], ["ODD_REG.csv", "regions_indicators.json"]] as const) {
  const rows = parse(fs.readFileSync(path.join(sourceDirectory, source), "utf8"), { columns: true, delimiter: ";", bom: true, skip_empty_lines: true }) as OddRow[];
  const grouped = Map.groupBy(rows, row => row.codgeo);
  const output = Object.fromEntries([...grouped].map(([code, territoryRows]) => {
    const territory = buildOfficialTerritory(territoryRows);
    if (source === "ODD_REG.csv" && budgetsByRegion.has(code)) {
      territory.finances = buildRegionalFinances(budgetsByRegion.get(code)!);
      territory.sources += " | OFGL/DGFiP — Comptes des régions 2024, budget principal";
      Object.assign(territory.provenance, { regionalAccounts: { dataset: "ofgl-base-regions", year: 2024, url: "https://data.ofgl.fr/explore/dataset/ofgl-base-regions/" } });
    }
    return [code, territory];
  }));
  fs.writeFileSync(path.join(root, `src/data/${destination}`), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`${destination}: ${Object.keys(output).length} official territories compiled.`);
}

const communeRows = parse(fs.readFileSync(communesPopulationFile, "utf8"), { columns: true, delimiter: ";", bom: true, skip_empty_lines: true }) as Array<Record<string, string>>;
const communes = buildCommunePopulations(communeRows);
fs.writeFileSync(path.join(root, "src/data/communes_indicators.json"), `${JSON.stringify(communes)}\n`);
console.log(`communes_indicators.json: ${Object.keys(communes).length - 1} official commune populations compiled.`);
