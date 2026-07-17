import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Finances RÉELLES des départements — source OFGL (agrégats retraités, budget principal).
// Miroir de sync-commune-finances.ts. Le millésime le plus récent est détecté automatiquement,
// donc les fiches suivent l'évolution de la base sans intervention.
const DATASET = "ofgl-base-departements";
const EXPORT = `https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/${DATASET}/exports/json`;
const FACETS = `https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/${DATASET}/facets`;
const SOURCE_URL = `https://data.ofgl.fr/explore/dataset/${DATASET}/`;

// Base régions : les collectivités uniques (Corse, Martinique, Guyane) exercent les
// compétences départementales mais sont publiées côté régions par l'OFGL.
const REGIONS_DATASET = "ofgl-base-regions";
const REGIONS_EXPORT = `https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/${REGIONS_DATASET}/exports/json`;
const REGIONS_SOURCE_URL = `https://data.ofgl.fr/explore/dataset/${REGIONS_DATASET}/`;

// Territoires dont l'entité budgétaire ne correspond pas au département historique.
// `entity_note` contient le NOM de l'entité réelle (le front l'insère dans une phrase).
const ALIASES: Array<{ from: string; to: string; note: string }> = [
  { from: "67A", to: "67", note: "Collectivité européenne d'Alsace" },
  { from: "67A", to: "68", note: "Collectivité européenne d'Alsace" },
];

// Collectivités uniques : reg_code OFGL → code(s) département attendu(s) par le site.
const UNIQUE_COLLECTIVITIES: Array<{ regCode: string; deps: string[]; note: string }> = [
  { regCode: "94", deps: ["2A", "2B"], note: "Collectivité de Corse" },
  { regCode: "02", deps: ["972"], note: "Collectivité territoriale de Martinique" },
  { regCode: "03", deps: ["973"], note: "Collectivité territoriale de Guyane" },
];

// Départements dont le périmètre budgétaire est amputé d'une métropole exerçant les
// compétences départementales sur une partie du territoire. Sans cette mention, les
// montants du Rhône (hors Métropole de Lyon, ~1,4 M d'habitants) induiraient en erreur.
const NOTES: Record<string, string> = {
  "69": "collectivité départementale du Rhône, hors Métropole de Lyon",
};

const INDICATORS: Array<{ code: string; agregat: string }> = [
  { code: "recettes_fonctionnement", agregat: "Recettes de fonctionnement" },
  { code: "depenses_fonctionnement", agregat: "Dépenses de fonctionnement" },
  { code: "epargne_brute", agregat: "Epargne brute" },
  { code: "depenses_investissement", agregat: "Dépenses d'investissement" },
  { code: "encours_dette", agregat: "Encours de dette" },
  // Compétences propres aux départements (action sociale = leur premier poste de dépense).
  { code: "allocations_rsa", agregat: "Allocations RSA" },
  { code: "allocations_apa", agregat: "Allocations APA" },
  { code: "allocations_pch", agregat: "Allocations PCH" },
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

async function latestYear(): Promise<string> {
  const data = await fetchJson(`${FACETS}?facet=annee_join`);
  const facet = (data.facets ?? []).find((f: any) => f.name === "annee_join");
  const years = (facet?.facets ?? []).map((x: any) => x.name).filter((y: string) => /^\d{4}$/.test(y)).sort();
  return years.at(-1) || "2024";
}

async function fetchIndicator(year: string, agregat: string): Promise<Map<string, { montant: number; eph: number }>> {
  const where = `annee_join="${year}" and type_de_budget="Budget principal" and agregat="${agregat}"`;
  const url = `${EXPORT}?where=${encodeURIComponent(where)}&select=${encodeURIComponent("dep_code,montant,euros_par_habitant")}`;
  const rows = await fetchJson(url);
  const out = new Map<string, { montant: number; eph: number }>();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const code = String(r.dep_code ?? "").trim();
    if (!code) continue;
    out.set(code, { montant: Number(r.montant) || 0, eph: Number(r.euros_par_habitant) || 0 });
  }
  return out;
}

// Même agrégat, mais depuis la base régions (pour les collectivités uniques).
async function fetchRegionIndicator(year: string, agregat: string): Promise<Map<string, { montant: number; eph: number }>> {
  const where = `annee_join="${year}" and type_de_budget="Budget principal" and agregat="${agregat}"`;
  const url = `${REGIONS_EXPORT}?where=${encodeURIComponent(where)}&select=${encodeURIComponent("reg_code,montant,euros_par_habitant")}`;
  const rows = await fetchJson(url);
  const out = new Map<string, { montant: number; eph: number }>();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const code = String(r.reg_code ?? "").trim();
    if (!code) continue;
    out.set(code, { montant: Number(r.montant) || 0, eph: Number(r.euros_par_habitant) || 0 });
  }
  return out;
}

export async function syncDepartmentFinances() {
  const year = await latestYear();
  const yearNum = Number(year);
  console.log(`[DepartmentFinances] Synchronisation OFGL — millésime ${year}…`);

  const rows: any[] = [];
  const now = new Date().toISOString();
  const push = (code: string, ind: string, v: { montant: number; eph: number }, note: string | null, src: string) => {
    rows.push({
      dep_code: code, year: yearNum, indicator: ind,
      montant: Math.round(v.montant),
      euros_par_habitant: v.eph ? Math.round(v.eph * 100) / 100 : null,
      entity_note: note, source_url: src, updated_at: now,
    });
  };

  for (const ind of INDICATORS) {
    // 1) Départements « classiques » (base départements).
    const map = await fetchIndicator(year, ind.agregat);
    for (const [code, v] of map) push(code, ind.code, v, NOTES[code] ?? null, SOURCE_URL);

    // 2) Alias (Alsace : 67A → 67 et 68).
    for (const a of ALIASES) {
      const v = map.get(a.from);
      if (v) push(a.to, ind.code, v, a.note, SOURCE_URL);
    }

    // 3) Collectivités uniques (Corse, Martinique, Guyane) via la base régions.
    const regMap = await fetchRegionIndicator(year, ind.agregat);
    let uniques = 0;
    for (const u of UNIQUE_COLLECTIVITIES) {
      const v = regMap.get(u.regCode);
      if (!v) continue;
      for (const dep of u.deps) { push(dep, ind.code, v, u.note, REGIONS_SOURCE_URL); uniques++; }
    }
    console.log(`[DepartmentFinances] ${ind.code}: ${map.size} départements (+${ALIASES.length} alias, +${uniques} collectivités uniques).`);
  }

  console.log(`[DepartmentFinances] Upsert de ${rows.length} lignes…`);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("department_finances").upsert(rows.slice(i, i + 500), { onConflict: "dep_code,year,indicator" });
    if (error) { console.error("[DepartmentFinances] upsert:", error.message); throw error; }
  }
  console.log(`[DepartmentFinances] Terminé. ${rows.length} lignes (millésime ${year}).`);
  return rows.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-department-finances.ts")) {
  syncDepartmentFinances().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
