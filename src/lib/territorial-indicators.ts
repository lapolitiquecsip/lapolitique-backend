export type OddRow = Record<string, string> & { codgeo: string; libgeo: string; no_indic: string; variable: string; sous_champ: string };

const YEARS = Array.from({ length: 72 }, (_, index) => `A${2025 - index}`);

export function latestValue(row: OddRow | undefined) {
  if (!row) return { value: null, year: null };
  for (const column of YEARS) {
    const raw = row[column]?.trim().replace(",", ".");
    if (raw && Number.isFinite(Number(raw))) return { value: Number(raw), year: Number(column.slice(1)) };
  }
  return { value: null, year: null };
}

const round = (value: number | null, digits = 1) => value === null ? null : Number(value.toFixed(digits));

export function buildOfficialTerritory(rows: OddRow[]) {
  const find = (variable: string, field = "") => rows.find(row => row.variable === variable && row.sous_champ === field);
  const value = (variable: string, field = "") => latestValue(find(variable, field)).value;
  const years = (...pairs: Array<[string, string?]>) => Object.fromEntries(pairs.map(([variable, field = ""]) => [variable, latestValue(find(variable, field)).year]));
  const maleLife = value("esper_vie", "homme");
  const femaleLife = value("esper_vie", "femme");
  const natural = value("surf_sols", "nat");
  const surface = value("surf_sols", "total");
  const violenceParts = ["infrac_tx_homicides", "infrac_tx_violences_horsfam", "infrac_tx_violences_sex", "infrac_tx_violences_intrafam"].map(name => value(name));
  const theftParts = ["infrac_tx_vols_pers", "infrac_tx_vols_vehic", "infrac_tx_cambriolages"].map(name => value(name));
  const sum = (items: Array<number | null>) => items.every(item => item === null) ? null : items.reduce<number>((total, item) => total + (item ?? 0), 0);

  return {
    id: rows[0]?.codgeo,
    name: rows[0]?.libgeo,
    demographie: { populationTotal: value("pop", ""), densite: null, evolution10ans: null, moins25ans: null, plus65ans: null },
    economie: { chomage: value("taux_chom_bit", "total"), revenuMedian: round(value("niveau_vie_median") === null ? null : value("niveau_vie_median")! / 12, 0), pauvrete: value("taux_pvt", "total") },
    education: { bac: null, diplomesSup: null, decrochage: value("part_20_24_sortis_nondip") },
    sante: { medecins10k: null, scoreAPL: round(value("apl_medgen_moins65"), 2), esperanceVie: maleLife !== null && femaleLife !== null ? round((maleLife + femaleLife) / 2) : null },
    securite: { atteintesPersonnes: round(sum(violenceParts), 2), atteintesBiens: round(sum(theftParts), 2) },
    logement: { prixM2: null, logementsSociaux: value("part_pls"), proprietaires: null },
    finances: { budgetHabitant: null, endettement: null, investissement: null },
    environnement: { qualiteAir: null, surfaceNaturelle: natural !== null && surface ? round(100 * natural / surface) : null, risques: null },
    sources: "Insee/SDES — Indicateurs territoriaux de développement durable, édition 2026",
    provenance: { dataset: "ODD_DEP/ODD_REG", url: "https://www.insee.fr/fr/statistiques/4505239", years: years(["pop"], ["taux_chom_bit", "total"], ["niveau_vie_median"], ["taux_pvt", "total"], ["part_20_24_sortis_nondip"], ["apl_medgen_moins65"], ["esper_vie", "homme"], ["infrac_tx_homicides"], ["part_pls"], ["surf_sols", "nat"]) },
  };
}
