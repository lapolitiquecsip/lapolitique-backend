import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// PLF 2026 « budget vert » — détail par programme (crédits de paiement).
const ENDPOINT = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/plf-2026-budget-vert/records";

async function main() {
  console.log("--- SYNC BUDGET PAR PROGRAMME (PLF 2026) ---");
  const records: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const res = await fetch(`${ENDPOINT}?limit=100&offset=${offset}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Budget API HTTP ${res.status}`);
    const page: any = await res.json();
    const results = page.results || [];
    records.push(...results);
    if (results.length < 100) break;
    if (offset > 20000) break; // garde-fou
  }
  console.log(`> ${records.length} lignes budget.`);

  // Agrège par (mission, programme) le montant PLF 2026.
  const map = new Map<string, { mission: string; num: string; name: string; amount: number }>();
  for (const r of records) {
    const mission = String(r.mission ?? "").trim();
    const num = String(r.numero_programme ?? "").trim();
    const name = String(r.programme ?? "").trim();
    if (!mission || !num || !name) continue;
    const amt = Number(r.plf_2026_cp_ou_prevision_2026_si_depense_fiscale) || 0;
    const key = `${mission}|${num}`;
    const cur = map.get(key) ?? { mission, num, name, amount: 0 };
    cur.amount += amt;
    map.set(key, cur);
  }

  const rows = [...map.values()]
    .filter(p => p.amount > 0)
    .map(p => ({
      mission_name: p.mission, programme_num: p.num, programme_name: p.name,
      amount_2026: Math.round(p.amount), fiscal_year: 2026, source_url: ENDPOINT, updated_at: new Date().toISOString(),
    }));
  console.log(`> ${rows.length} programme(s).`);
  if (rows.length) {
    const { error } = await supabase.from("state_budget_programmes").upsert(rows, { onConflict: "mission_name,programme_num,fiscal_year" });
    if (error) throw error;
  }
  console.log("--- TERMINE ---");
}

main().catch(e => { console.error(e); process.exit(1); });
