import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Finances des régions (OFGL). API Opendatasoft live → mise à jour automatique.
const OFGL = "https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/ofgl-base-regions/records";

// Indicateurs clés ingérés (code interne ↔ agrégat OFGL).
const INDICATORS: Array<{ code: string; agregat: string }> = [
  { code: "epargne_brute", agregat: "Epargne brute" },
  { code: "encours_dette", agregat: "Encours de dette" },
  { code: "depenses_fonctionnement", agregat: "Dépenses de fonctionnement" },
  { code: "depenses_investissement", agregat: "Dépenses d'investissement" },
  { code: "depenses_totales", agregat: "Dépenses totales" },
];

async function fetchIndicator(agregat: string) {
  const where = `agregat="${agregat}" and type_de_budget="Budget principal"`;
  const rows: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const url = `${OFGL}?where=${encodeURIComponent(where)}&select=exer,reg_code,reg_name,montant_en_millions,euros_par_habitant&limit=100&offset=${offset}`;
    const res = await fetch(url, { headers: { "User-Agent": "LaPolitiqueBot/1.0" }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`OFGL HTTP ${res.status} pour ${agregat}`);
    const data: any = await res.json();
    rows.push(...(data.results ?? []));
    if (!data.results || data.results.length < 100) break;
  }
  return rows;
}

export async function syncRegionFinances() {
  console.log("[RegionFinances] Synchronisation OFGL...");
  let total = 0;
  for (const ind of INDICATORS) {
    const rows = await fetchIndicator(ind.agregat);

    // Agrège les régions historiques regroupées sous le même code avant la réforme
    // de 2016 (ex. Grand Est 2012 = Alsace + Champagne-Ardenne + Lorraine).
    // On somme les montants et on recompose la population pour le €/habitant.
    const agg = new Map<string, { region_code: string; region_name: string | null; year: number; montant: number; pop: number }>();
    for (const r of rows) {
      if (!r.reg_code || !r.exer) continue;
      const key = `${r.reg_code}-${r.exer}`;
      const montant = Number(r.montant_en_millions) || 0;
      const eph = Number(r.euros_par_habitant) || 0;
      const pop = eph ? (montant * 1_000_000) / eph : 0;
      const cur = agg.get(key) ?? { region_code: String(r.reg_code), region_name: r.reg_name ?? null, year: Number(r.exer), montant: 0, pop: 0 };
      cur.montant += montant;
      cur.pop += pop;
      agg.set(key, cur);
    }
    const payload = [...agg.values()].map(a => ({
      region_code: a.region_code,
      region_name: a.region_name,
      year: a.year,
      indicator: ind.code,
      montant_millions: a.montant,
      euros_par_habitant: a.pop ? (a.montant * 1_000_000) / a.pop : null,
      updated_at: new Date().toISOString(),
    }));

    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase
        .from("region_finances")
        .upsert(payload.slice(i, i + 500), { onConflict: "region_code,year,indicator" });
      if (error) { console.error(`[RegionFinances] upsert ${ind.code}:`, error.message); break; }
    }
    total += payload.length;
    console.log(`[RegionFinances] ${ind.code}: ${payload.length} lignes.`);
  }
  console.log(`[RegionFinances] Terminé. ${total} lignes au total.`);
  return total;
}

if (process.argv[1] && process.argv[1].endsWith("sync-region-finances.ts")) {
  syncRegionFinances().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
