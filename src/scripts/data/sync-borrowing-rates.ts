import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Taux d'emprunt à 10 ans (critère de Maastricht) — Eurostat, mensuel. Automatise le tableau
// comparatif des finances publiques (évite qu'il ne devienne périmé comme en juin→août 2026).
// Écrit dans national_finance_indicators (déjà existante) : 1 ligne par pays, value_type='observed',
// indicator_code='long_term_rate_<GEO>'. Le front lit le live et retombe sur des valeurs codées si vide.
// Gratuit, sans clé. Idempotent (upsert).

const GEOS = ["FR", "DE", "NL", "ES", "BE", "IT", "EA"];
const EUROSTAT = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/irt_lt_mcby_m?format=JSON&lang=EN&lastTimePeriod=6&${GEOS.map(g => "geo=" + g).join("&")}`;

async function main() {
  const res = await fetch(EUROSTAT, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Eurostat HTTP ${res.status}`);
  const j: any = await res.json();
  const times: string[] = Object.entries(j.dimension.time.category.index).sort((a: any, b: any) => a[1] - b[1]).map((x: any) => x[0]);
  const geoIdx: Record<string, number> = j.dimension.geo.category.index;
  const tSize = times.length;
  const val: Record<string, number> = j.value;

  const rows: any[] = [];
  let latestMonth = "";
  for (const g of GEOS) {
    const gi = geoIdx[g];
    // Dernier mois non nul pour ce pays (dimension order geo,time).
    for (let t = tSize - 1; t >= 0; t--) {
      const v = val[gi * tSize + t];
      if (v != null) {
        const month = times[t];
        if (month > latestMonth) latestMonth = month;
        rows.push({
          indicator_code: `long_term_rate_${g}`,
          reference_year: Number(month.slice(0, 4)),
          value: Math.round(v * 100) / 100,
          unit: "%",
          value_type: "observed",
          source_urls: ["https://ec.europa.eu/eurostat/databrowser/view/irt_lt_mcby_m/default/table"],
          source_updated_at: `${month}-01T00:00:00Z`,
          collected_at: new Date().toISOString(),
        });
        break;
      }
    }
  }
  if (!rows.length) throw new Error("Aucun taux Eurostat récupéré");

  const { error } = await supabase.from("national_finance_indicators").upsert(rows, { onConflict: "indicator_code,reference_year,value_type" });
  if (error) throw error;
  console.log(`Taux d'emprunt mis à jour (${latestMonth}) : ${rows.map(r => `${r.indicator_code.replace("long_term_rate_", "")}=${r.value}%`).join(", ")}`);
}

main().catch(e => { console.error(e); process.exit(1); });
