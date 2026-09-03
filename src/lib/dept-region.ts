// Correspondance officielle INSEE département → région (codes bruts, sans préfixe).
// Sert à router une actu RÉGIONALE vers les membres de la région, à partir de leur département.
// Régions : 11 Île-de-France, 24 Centre-Val de Loire, 27 Bourgogne-Franche-Comté, 28 Normandie,
// 32 Hauts-de-France, 44 Grand Est, 52 Pays de la Loire, 53 Bretagne, 75 Nouvelle-Aquitaine,
// 76 Occitanie, 84 Auvergne-Rhône-Alpes, 93 PACA, 94 Corse ; Outre-mer : 01 Guadeloupe,
// 02 Martinique, 03 Guyane, 04 La Réunion, 06 Mayotte.

const DEPTS_BY_REGION: Record<string, string[]> = {
  "84": ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"],
  "27": ["21", "25", "39", "58", "70", "71", "89", "90"],
  "53": ["22", "29", "35", "56"],
  "24": ["18", "28", "36", "37", "41", "45"],
  "94": ["2a", "2b"],
  "44": ["08", "10", "51", "52", "54", "55", "57", "67", "68", "88"],
  "32": ["02", "59", "60", "62", "80"],
  "11": ["75", "77", "78", "91", "92", "93", "94", "95"],
  "28": ["14", "27", "50", "61", "76"],
  "75": ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"],
  "76": ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"],
  "52": ["44", "49", "53", "72", "85"],
  "93": ["04", "05", "06", "13", "83", "84"],
  "01": ["971"],
  "02": ["972"],
  "03": ["973"],
  "04": ["974"],
  "06": ["976"],
};

// Régions métropolitaines + DOM (code brut → nom).
export const REGIONS: Record<string, string> = {
  "11": "Île-de-France", "24": "Centre-Val de Loire", "27": "Bourgogne-Franche-Comté",
  "28": "Normandie", "32": "Hauts-de-France", "44": "Grand Est", "52": "Pays de la Loire",
  "53": "Bretagne", "75": "Nouvelle-Aquitaine", "76": "Occitanie", "84": "Auvergne-Rhône-Alpes",
  "93": "Provence-Alpes-Côte d'Azur", "94": "Corse", "01": "Guadeloupe", "02": "Martinique",
  "03": "Guyane", "04": "La Réunion", "06": "Mayotte",
};

const DEPT_TO_REGION: Record<string, string> = {};
for (const [region, depts] of Object.entries(DEPTS_BY_REGION)) for (const d of depts) DEPT_TO_REGION[d] = region;

// Code région (brut) à partir d'un code département (brut). null si inconnu.
export function regionOfDept(deptCode: string | null | undefined): string | null {
  if (!deptCode) return null;
  return DEPT_TO_REGION[String(deptCode).toLowerCase().padStart(2, "0")] ?? DEPT_TO_REGION[String(deptCode).toLowerCase()] ?? null;
}
