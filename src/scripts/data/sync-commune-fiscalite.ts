import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Fiscalité locale des communes — REI (Recensement des Éléments d'Imposition), via OFGL.
// Le millésime le plus récent est détecté automatiquement : les fiches suivent la base.
//
// Périmètre : uniquement la part COMMUNALE. Depuis la réforme de 2021, les départements
// et les régions ne votent plus de taux de FB/TH (compensés en TVA) — il n'y a donc rien
// à publier pour eux ici.
const DATASET = "rei";
const EXPORT = `https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/${DATASET}/exports/json`;
const FACETS = `https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/${DATASET}/facets`;
const SOURCE_URL = `https://data.ofgl.fr/explore/dataset/${DATASET}/`;

// Variable REI → indicateur interne.
//   E12 / H12 / B12   = taux nets votés (foncier bâti, habitation rés. secondaires, non bâti)
//   E13 / H13THS / B13 = produits réels correspondants
const VAR_MAP: Record<string, string> = {
  E12: "taux_fb",
  H12: "taux_th",
  B12: "taux_fnb",
  E13: "produit_fb",
  H13THS: "produit_th",
  B13: "produit_fnb",
};

// Le REI perd le zéro initial des départements 01→09 : Nice y est « 6088 » et non
// « 06088 » (3 135 communes concernées). Sans ce recadrage, leur fiscalité ne serait
// jamais retrouvée par le site, qui utilise le code INSEE à 5 caractères.
// La Corse (« 2A004 ») et l'outre-mer (« 97xxx ») font déjà 5 caractères.
function normalizeInsee(idcom: string): string | null {
  const code = String(idcom ?? "").trim();
  if (!code) return null;
  if (code.length === 4 && /^\d{4}$/.test(code)) return code.padStart(5, "0");
  return code.length === 5 ? code : null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url: string, tries = 4): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "LaPolitiqueBot/1.0" }, signal: AbortSignal.timeout(120000) });
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
  const data = await fetchJson(`${FACETS}?facet=annee`);
  const facet = (data.facets ?? []).find((f: any) => f.name === "annee");
  const years = (facet?.facets ?? []).map((x: any) => x.name).filter((y: string) => /^\d{4}$/.test(y)).sort();
  return years.at(-1) || "2025";
}

export async function syncCommuneFiscalite() {
  const year = await latestYear();
  const yearNum = Number(year);
  console.log(`[CommuneFiscalite] Synchronisation REI — millésime ${year}…`);

  const vars = Object.keys(VAR_MAP);
  const where = `annee="${year}" and destinataire="Commune" and var in (${vars.map(v => `"${v}"`).join(",")})`;
  const url = `${EXPORT}?where=${encodeURIComponent(where)}&select=${encodeURIComponent("idcom,var,valeur")}`;
  const data = await fetchJson(url);
  const records: any[] = Array.isArray(data) ? data : [];
  console.log(`[CommuneFiscalite] ${records.length} lignes REI.`);

  const now = new Date().toISOString();
  const rows: any[] = [];
  for (const r of records) {
    const insee = normalizeInsee(r.idcom);
    const indicator = VAR_MAP[String(r.var ?? "")];
    if (!insee || !indicator || r.valeur == null) continue;
    const valeur = Number(r.valeur);
    if (!Number.isFinite(valeur)) continue;
    rows.push({
      insee_code: insee, year: yearNum, indicator,
      // Taux en %, produits arrondis à l'euro.
      valeur: indicator.startsWith("taux_") ? Math.round(valeur * 100) / 100 : Math.round(valeur),
      source_url: SOURCE_URL, updated_at: now,
    });
  }

  console.log(`[CommuneFiscalite] Upsert de ${rows.length} lignes…`);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("commune_fiscalite").upsert(rows.slice(i, i + 500), { onConflict: "insee_code,year,indicator" });
    if (error) { console.error("[CommuneFiscalite] upsert:", error.message); throw error; }
  }
  const communes = new Set(rows.map(r => r.insee_code)).size;
  console.log(`[CommuneFiscalite] Terminé. ${rows.length} lignes / ${communes} communes (millésime ${year}).`);
  return rows.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-commune-fiscalite.ts")) {
  syncCommuneFiscalite().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
