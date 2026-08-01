import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Finances des partis : données CURÉES et 100 % SOURCÉES (aucune estimation maison).
//  • subventions_eur  : aide publique de l'État — décret de répartition 2025 (JO).
//  • dettes_eur / produits_eur : comptes des partis, exercice 2024, publiés par la CNCCFP (JO/Légifrance).
//    Le taux d'endettement affiché = dettes / produits annuels (calcul côté front).
//
// Sources :
//  - Décret 2025 portant répartition de l'aide publique aux partis (Wikipédia « Financement des partis politiques français », transcription du décret).
//  - CNCCFP, « Avis relatif à la publication générale des comptes des partis — exercice 2024 » (Légifrance JORFTEXT000053453043).
//
// Renaissance et le MoDem perçoivent l'aide publique collectivement via « Ensemble » : l'enveloppe
// est portée sur la fiche Renaissance avec le libellé adéquat ; le MoDem n'a pas de ligne propre.

const AIDE_SRC = "Aide publique de l'État — décret de répartition 2025 (JO)";
const COMPTES_SRC = "Comptes 2024 des partis — CNCCFP (avis publié au JO)";

type Fin = {
  slug: string;
  subventions_eur?: number;
  subventions_note?: string;   // précision de libellé si nécessaire
  dettes_eur?: number;
  produits_eur?: number;
};

const DATA: Fin[] = [
  { slug: "rassemblement-national", subventions_eur: 14_800_159, dettes_eur: 18_913_105, produits_eur: 18_704_246 },
  { slug: "renaissance",           subventions_eur: 11_321_238, subventions_note: "enveloppe « Ensemble » (Renaissance + MoDem)", dettes_eur: 5_166, produits_eur: 19_474_809 },
  { slug: "la-france-insoumise",   subventions_eur: 6_679_232,  dettes_eur: 5_890_845,  produits_eur: 13_786_068 },
  { slug: "parti-socialiste",      subventions_eur: 7_903_387,  dettes_eur: 7_911_998,  produits_eur: 15_742_678 },
  { slug: "les-republicains",      subventions_eur: 7_458_478,  dettes_eur: 12_292_671, produits_eur: 15_687_744 },
  { slug: "les-ecologistes",       subventions_eur: 3_502_497,  dettes_eur: 7_912_847,  produits_eur: 8_790_155 },
  { slug: "horizons",              subventions_eur: 3_025_582 },
  { slug: "parti-communiste-francais", subventions_eur: 2_105_961, dettes_eur: 5_297_288, produits_eur: 31_609_024 },
  { slug: "union-des-droites",     subventions_eur: 630_735 },
];

async function main() {
  console.log("--- SEED finances partis (curé, sourcé) ---");
  for (const d of DATA) {
    const patch: Record<string, any> = {};
    if (d.subventions_eur != null) {
      patch.subventions_eur = d.subventions_eur;
      patch.subventions_year = 2025;
      patch.subventions_source = d.subventions_note ? `${AIDE_SRC} — ${d.subventions_note}` : AIDE_SRC;
    }
    if (d.dettes_eur != null && d.produits_eur != null) {
      patch.dettes_eur = d.dettes_eur;
      patch.produits_eur = d.produits_eur;
      patch.comptes_year = 2024;
      patch.comptes_source = COMPTES_SRC;
    }
    const { error } = await supabase.from("political_parties").update(patch).eq("slug", d.slug);
    if (error) { console.error(`  ! ${d.slug}: ${error.message}`); continue; }
    const taux = d.dettes_eur != null && d.produits_eur ? Math.round((d.dettes_eur / d.produits_eur) * 100) : null;
    console.log(`  ✓ ${d.slug} : aide ${(d.subventions_eur ?? 0) / 1e6} M€${taux != null ? ` | endettement ${taux}%` : ""}`);
  }
  console.log("--- TERMINE ---");
}

main().catch(e => { console.error(e); process.exit(1); });
