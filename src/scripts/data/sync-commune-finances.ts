import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Finances RÉELLES des communes — source OFGL (Observatoire des Finances et de la Gestion
// publique Locales). Agrégats déjà retraités (dépenses/recettes réelles, épargne, dette),
// bien plus précis que le grand livre brut des balances comptables.
const DATASET = "ofgl-base-communes";
const RECORDS = `https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/${DATASET}/records`;
const SOURCE_URL = `https://data.ofgl.fr/explore/dataset/${DATASET}/`;

// Indicateur interne ↔ agrégat OFGL (budget principal).
const INDICATORS: Array<{ code: string; agregat: string }> = [
  { code: "recettes_fonctionnement", agregat: "Recettes de fonctionnement" },
  { code: "depenses_fonctionnement", agregat: "Dépenses de fonctionnement" },
  { code: "epargne_brute", agregat: "Epargne brute" },
  { code: "depenses_investissement", agregat: "Dépenses d'investissement" },
  { code: "encours_dette", agregat: "Encours de dette" },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

// Dernier millésime disponible (champ texte annee_join).
async function latestYear(): Promise<string> {
  const data = await fetchJson(`https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/${DATASET}/facets?facet=annee_join`);
  const facet = (data.facets ?? []).find((f: any) => f.name === "annee_join");
  const years = (facet?.facets ?? []).map((x: any) => x.name).filter((y: string) => /^\d{4}$/.test(y)).sort();
  return years.at(-1) || "2024";
}

async function fetchIndicator(year: string, agregat: string): Promise<Map<string, { montant: number; eph: number }>> {
  const where = `annee_join="${year}" and type_de_budget="Budget principal" and agregat="${agregat}"`;
  const out = new Map<string, { montant: number; eph: number }>();
  for (let offset = 0; ; offset += 100) {
    const url = `${RECORDS}?where=${encodeURIComponent(where)}` +
      `&select=${encodeURIComponent("com_code,montant,euros_par_habitant")}&limit=100&offset=${offset}`;
    const data = await fetchJson(url);
    const rows = data.results ?? [];
    for (const r of rows) {
      const code = String(r.com_code ?? "").trim();
      if (!code) continue;
      out.set(code, { montant: Number(r.montant) || 0, eph: Number(r.euros_par_habitant) || 0 });
    }
    if (rows.length < 100) break;
    await sleep(60);
  }
  return out;
}

export async function syncCommuneFinances() {
  const year = await latestYear();
  const yearNum = Number(year);
  console.log(`[CommuneFinances] Synchronisation OFGL — millésime ${year}…`);

  const rows: any[] = [];
  for (const ind of INDICATORS) {
    const map = await fetchIndicator(year, ind.agregat);
    for (const [code, v] of map) {
      rows.push({
        insee_code: code, year: yearNum, indicator: ind.code,
        montant: Math.round(v.montant),
        euros_par_habitant: v.eph ? Math.round(v.eph * 100) / 100 : null,
        source_url: SOURCE_URL, updated_at: new Date().toISOString(),
      });
    }
    console.log(`[CommuneFinances] ${ind.code}: ${map.size} communes.`);
  }

  console.log(`[CommuneFinances] Upsert de ${rows.length} lignes…`);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("commune_finances").upsert(rows.slice(i, i + 500), { onConflict: "insee_code,year,indicator" });
    if (error) { console.error("[CommuneFinances] upsert:", error.message); throw error; }
  }
  console.log(`[CommuneFinances] Terminé. ${rows.length} lignes (millésime ${year}).`);
  return rows.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-commune-finances.ts")) {
  syncCommuneFinances().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
