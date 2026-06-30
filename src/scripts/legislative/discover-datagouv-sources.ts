import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callDataGouvTool } from "../../lib/legislative/datagouv-mcp.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifestPath = path.join(root, "config", "legislative-sources.json");

export async function discoverDataGouvSources() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const datasets = [];
  for (const source of manifest.datasets) {
    const [info, resources] = await Promise.all([
      callDataGouvTool("get_dataset_info", { dataset_id: source.datasetId }),
      callDataGouvTool("list_dataset_resources", { dataset_id: source.datasetId }),
    ]);
    datasets.push({ ...source, verifiedAt: new Date().toISOString(), info: info.structuredContent ?? info, resources: resources.structuredContent ?? resources });
  }
  const updated = { ...manifest, discoveredAt: new Date().toISOString(), datasets };
  await fs.writeFile(manifestPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  console.log(`Verified ${datasets.length} official data.gouv.fr datasets in ${manifestPath}`);
}

discoverDataGouvSources().catch(error => { console.error(error); process.exitCode = 1; });
