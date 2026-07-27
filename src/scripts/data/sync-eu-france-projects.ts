import "dotenv/config";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";

// Projets concrets cofinancés par l'UE en France — base OFFICIELLE Kohesio (DG REGIO). L'API
// n'a pas de filtre pays stable, mais `keywords=<région>&language=fr` renvoie de vrais projets
// FR (labels français), paginables via `offset`. On balaie les régions, on garde les projets
// countrycode=FR avec un montant UE, on déduplique. Rien d'inventé : lien Kohesio sur chaque projet.
const API = "https://kohesio.ec.europa.eu/api/projects";
const REGIONS = [
  "Île-de-France", "Auvergne-Rhône-Alpes", "Nouvelle-Aquitaine", "Occitanie", "Hauts-de-France",
  "Grand Est", "Provence-Alpes-Côte d'Azur", "Pays de la Loire", "Normandie", "Bretagne",
  "Bourgogne-Franche-Comté", "Centre-Val de Loire", "Corse", "La Réunion", "Guadeloupe",
  "Martinique", "Guyane", "Mayotte",
];

const num = (v?: string) => { const n = v ? Math.round(parseFloat(v)) : NaN; return Number.isFinite(n) ? n : null; };
const clean = (s?: string) => s ? cheerio.load(`<x>${s}</x>`)("x").text().replace(/\s+/g, " ").trim() : null;

async function fetchPage(region: string, offset: number): Promise<any[]> {
  const url = `${API}?keywords=${encodeURIComponent(region)}&language=fr&offset=${offset}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 LaPolitiqueBot", "Accept": "application/json" }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return [];
    const json = await res.json();
    return json?.list || [];
  } catch { return []; }
}

export async function syncEuFranceProjects() {
  console.log("--- SYNC PROJETS FINANCÉS PAR L'UE EN FRANCE (Kohesio) ---");
  const byId = new Map<string, any>();
  for (const region of REGIONS) {
    let kept = 0;
    for (const offset of [0, 15, 30]) {                    // ~45 projets balayés par région
      const list = await fetchPage(region, offset);
      if (!list.length) break;
      for (const p of list) {
        if (!Array.isArray(p.countrycode) || !p.countrycode.includes("FR")) continue;   // FR uniquement
        const euBudget = num(p.euBudgets?.[0]);
        if (!euBudget) continue;                            // sans montant UE = pas exploitable
        const id = p.item;
        if (byId.has(id)) continue;
        const coord = (p.coordinates?.[0] || "").split(",");   // "lng,lat"
        byId.set(id, {
          id,
          name: (p.labels?.[0] || "Projet cofinancé par l'UE").slice(0, 300),
          eu_budget_eur: euBudget,
          total_budget_eur: num(p.totalBudgets?.[0]),
          region,
          lng: coord.length === 2 ? parseFloat(coord[0]) : null,
          lat: coord.length === 2 ? parseFloat(coord[1]) : null,
          image_url: p.images?.[0] || null,
          description: clean(p.descriptions?.[0])?.slice(0, 600) || null,
          url: `https://kohesio.ec.europa.eu/fr/projects/${id}`,
          updated_at: new Date().toISOString(),
        });
        kept++;
      }
    }
    console.log(`  ${region} : +${kept}`);
  }

  const rows = [...byId.values()];
  console.log(`> ${rows.length} projets FR cofinancés retenus.`);
  if (rows.length) {
    // upsert par lots (payloads volumineux avec descriptions).
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from("eu_france_projects").upsert(rows.slice(i, i + 200), { onConflict: "id" });
      if (error) { console.error("[eu-projets] upsert:", error.message); throw error; }
    }
  }
  console.log(`--- TERMINE. ${rows.length} projets. ---`);
  return rows.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-eu-france-projects.ts")) {
  syncEuFranceProjects().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
