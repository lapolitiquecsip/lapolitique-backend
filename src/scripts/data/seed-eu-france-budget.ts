import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// France ↔ budget de l'UE : donnée CURÉE annuelle, 100 % sourcée (aucune estimation maison).
// Une ligne par année, base « hors plan de relance » (budget traditionnel) pour que les années
// soient COMPARABLES. Le plan de relance NextGenerationEU (exceptionnel, 2021-2026) est porté
// comme une entrée de breakdown marquée { recovery: true } : le front l'affiche à part et
// recalcule le solde « avec plan » sans fausser la série hors plan.
//
// Sources :
//  - Sénat, « Participation de la France au budget de l'UE » (PLF, annuel).
//  - Commission européenne / Toute l'Europe, « Où va l'argent de l'UE en France ? » (maj 2026).
//    https://www.touteleurope.eu/economie-et-social/budget-ou-va-l-argent-de-l-union-europeenne-en-france/

type Row = {
  year: number;
  contribution_eur: number;   // ce que la France verse (hors plan de relance)
  spending_eur: number;       // ce que l'UE dépense en France (hors plan de relance)
  breakdown: Array<{ label: string; amount_eur: number; recovery?: boolean }>;
  source_url: string;
  source_label: string;
};

const ROWS: Row[] = [
  {
    year: 2023,
    contribution_eur: 25_800_000_000,
    spending_eur: 16_498_000_000,   // net traditionnel = −9,333 Md€ (2ᵉ contributeur net de l'UE)
    breakdown: [
      { label: "Agriculture (PAC)", amount_eur: 9_500_000_000 },
      { label: "Compétitivité & recherche", amount_eur: 2_700_000_000 },
      { label: "Cohésion", amount_eur: 2_300_000_000 },
      { label: "Autres politiques", amount_eur: 1_998_000_000 },
      // Avec le plan de relance, la France était bénéficiaire nette (+5 Md€) en 2023.
      { label: "Plan de relance (NextGenerationEU)", amount_eur: 14_800_000_000, recovery: true },
    ],
    source_url: "https://www.senat.fr/rap/l23-128-22/l23-128-22-syn.pdf",
    source_label: "Sénat — Participation de la France au budget de l'UE (2023)",
  },
  {
    year: 2024,
    contribution_eur: 22_300_000_000,
    spending_eur: 16_400_000_000,   // hors plan → net traditionnel = −5,9 Md€
    breakdown: [
      { label: "Agriculture (PAC)", amount_eur: 9_580_000_000 },
      { label: "Compétitivité & recherche", amount_eur: 3_390_000_000 },
      { label: "Cohésion", amount_eur: 2_130_000_000 },
      { label: "Autres politiques", amount_eur: 1_350_000_000 },
      // Avec le plan de relance (+8,9 Md€), la France est bénéficiaire nette (+3,0 Md€) en 2024.
      { label: "Plan de relance (NextGenerationEU)", amount_eur: 8_900_000_000, recovery: true },
    ],
    source_url: "https://www.touteleurope.eu/economie-et-social/budget-ou-va-l-argent-de-l-union-europeenne-en-france/",
    source_label: "Commission européenne / Toute l'Europe — dépenses de l'UE en France (2024)",
  },
];

async function main() {
  console.log("--- SEED eu_france_budget (curé, sourcé) ---");
  for (const r of ROWS) {
    const { error } = await supabase.from("eu_france_budget").upsert(
      { ...r, updated_at: new Date().toISOString() },
      { onConflict: "year" },
    );
    if (error) { console.error(`  ! ${r.year}: ${error.message}`); continue; }
    const net = r.spending_eur - r.contribution_eur;
    console.log(`  ✓ ${r.year} : verse ${(r.contribution_eur / 1e9).toFixed(1)} / reçoit ${(r.spending_eur / 1e9).toFixed(1)} → solde ${(net / 1e9).toFixed(1)} Md€ (hors plan)`);
  }
  console.log("--- TERMINE ---");
}

main().catch(e => { console.error(e); process.exit(1); });
