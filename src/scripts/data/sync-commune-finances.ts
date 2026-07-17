import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Balances comptables des communes 2025 (data.economie.gouv / DGFiP).
// On agrège, par commune (budget principal uniquement), le grand livre en 3 indicateurs
// lisibles et vérifiables :
//   - produits_fonctionnement  = Σ classe 7 (solde créditeur net)   → recettes de fonctionnement
//   - charges_fonctionnement   = Σ classe 6 (solde débiteur net)    → dépenses de fonctionnement
//   - encours_dette            = Σ compte 16 (solde créditeur net)  → emprunts et dettes assimilées
const DATASET = "balances-comptables-des-communes-en-2025";
const BASE = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/${DATASET}`;
const RECORDS = `${BASE}/records`;
const SOURCE_URL = `https://data.economie.gouv.fr/explore/dataset/${DATASET}/`;
const YEAR = 2025;

// Filtre commun : budget principal, entité "commune" (ou Ville de Paris).
const COMMUNE_FILTER = `cbudg="1" and (categ="Commune" or categ="PARIS")`;

// Définition des 3 indicateurs : préfixe de compte + sens du solde net.
const METRICS: Array<{ code: string; comptePrefix: string; sign: "sc-sd" | "sd-sc" }> = [
  { code: "produits_fonctionnement", comptePrefix: "7", sign: "sc-sd" },
  { code: "charges_fonctionnement", comptePrefix: "6", sign: "sd-sc" },
  { code: "encours_dette", comptePrefix: "16", sign: "sc-sd" },
];

async function fetchJson(url: string, tries = 4): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "LaPolitiqueBot/1.0" }, signal: AbortSignal.timeout(45000) });
      if (res.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function listDepts(): Promise<string[]> {
  const data = await fetchJson(`${BASE}/facets?facet=ndept`);
  const facet = (data.facets ?? []).find((f: any) => f.name === "ndept");
  return (facet?.facets ?? []).map((x: any) => x.name);
}

// Code INSEE réel à partir de (ndept, insee) du jeu de données.
function toInsee(ndept: string, insee: string): string | null {
  if (!ndept || !insee) return null;
  const dom: Record<string, string> = { "101": "971", "102": "972", "103": "973", "104": "974", "105": "975", "106": "976" };
  if (dom[ndept]) return dom[ndept] + insee.slice(1);   // '101','101' -> '971'+'01' = 97101
  if (ndept[0] === "0") return ndept.slice(1) + insee;  // '059','350' -> '59350' ; '02A','004' -> '2A004'
  return ndept + insee;                                 // filet de sécurité
}

// Agrège un indicateur pour un département → Map<insee_full, montant>.
async function fetchMetricForDept(ndept: string, m: (typeof METRICS)[number]): Promise<Map<string, number>> {
  const where = `ndept="${ndept}" and ${COMMUNE_FILTER} and startswith(compte,"${m.comptePrefix}")`;
  const out = new Map<string, number>();
  for (let offset = 0; ; offset += 100) {
    const url = `${RECORDS}?where=${encodeURIComponent(where)}&group_by=${encodeURIComponent("ndept,insee")}` +
      `&select=${encodeURIComponent("sum(sc) as sc, sum(sd) as sd")}&limit=100&offset=${offset}`;
    const data = await fetchJson(url);
    const rows = data.results ?? [];
    for (const r of rows) {
      const insee = toInsee(String(r.ndept ?? ndept), String(r.insee ?? ""));
      if (!insee) continue;
      const sc = Number(r.sc) || 0;
      const sd = Number(r.sd) || 0;
      const net = m.sign === "sc-sd" ? sc - sd : sd - sc;
      out.set(insee, (out.get(insee) ?? 0) + net);
    }
    if (rows.length < 100) break;
  }
  return out;
}

export async function syncCommuneFinances() {
  console.log("[CommuneFinances] Synchronisation balances comptables 2025…");
  const depts = await listDepts();
  console.log(`[CommuneFinances] ${depts.length} départements.`);

  const rows: any[] = [];
  let done = 0;
  for (const ndept of depts) {
    for (const m of METRICS) {
      const map = await fetchMetricForDept(ndept, m);
      for (const [insee, montant] of map) {
        // Arrondi à l'euro ; on ignore les montants nuls exacts (compte absent).
        if (!montant) continue;
        rows.push({ insee_code: insee, year: YEAR, indicator: m.code, montant: Math.round(montant), source_url: SOURCE_URL, updated_at: new Date().toISOString() });
      }
      await sleep(120); // politesse API
    }
    done++;
    if (done % 10 === 0) console.log(`[CommuneFinances] ${done}/${depts.length} départements traités (${rows.length} lignes).`);
  }

  console.log(`[CommuneFinances] Upsert de ${rows.length} lignes…`);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("commune_finances").upsert(rows.slice(i, i + 500), { onConflict: "insee_code,year,indicator" });
    if (error) { console.error("[CommuneFinances] upsert:", error.message); throw error; }
  }
  console.log(`[CommuneFinances] Terminé. ${rows.length} lignes.`);
  return rows.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-commune-finances.ts")) {
  syncCommuneFinances().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
