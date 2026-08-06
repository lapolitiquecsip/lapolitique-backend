import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Enrichit deputies.photo_url avec une photo Wikimedia Commons HAUTE RÉSOLUTION.
// Les photos officielles de l'Assemblée plafonnent à ~240 px (floues en grand) ; Commons offre
// souvent 800–2000 px. Match STRICTEMENT par identifiant officiel (Wikidata P4123 = « identifiant
// Assemblée nationale »), jamais par nom → aucun risque de photo du mauvais homonyme.
// L'AN reste le repli côté front pour les députés sans photo Commons.

const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
const WIDTH = 800; // largeur cible des vignettes Commons

// Récupère, pour chaque personne ayant un identifiant AN (P4123) et une image (P18),
// le couple (id AN numérique → nom de fichier Commons). Une seule requête SPARQL.
async function fetchWikidataPhotos(): Promise<Map<string, string>> {
  const query = "SELECT ?anid ?img WHERE { ?p wdt:P4123 ?anid . ?p wdt:P18 ?img . }";
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { ...UA, Accept: "application/sparql-results+json" }, signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`SPARQL HTTP ${res.status}`);
  const data: any = await res.json();
  const map = new Map<string, string>();
  for (const row of data.results.bindings) {
    const anid = String(row.anid?.value || "").trim();
    const imgUrl = String(row.img?.value || "");
    if (!anid || !imgUrl) continue;
    // Extrait le nom de fichier de l'URL FilePath, puis reconstruit une vignette redimensionnée.
    const file = decodeURIComponent(imgUrl.split("/Special:FilePath/")[1] || "");
    if (!file) continue;
    // Une personne peut avoir plusieurs valeurs P4123 (rare) : la 1re gagne, c'est suffisant.
    if (!map.has(anid)) map.set(anid, file);
  }
  return map;
}

const commonsThumb = (file: string) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, "_"))}?width=${WIDTH}`;

async function main() {
  console.log("→ Récupération des photos Commons via Wikidata (P4123 → P18)…");
  const photos = await fetchWikidataPhotos();
  console.log(`  ${photos.size} photos Commons indexées par identifiant AN.`);

  const { data: deputies, error } = await supabase
    .from("deputies")
    .select("id, an_id, first_name, last_name, photo_url");
  if (error) throw error;
  console.log(`→ ${deputies?.length ?? 0} députés en base.`);

  let matched = 0, updated = 0, skipped = 0;
  for (const d of deputies || []) {
    const anId = (d.an_id || "").replace(/^PA/, "").trim();
    if (!anId) { skipped++; continue; }
    const file = photos.get(anId);
    if (!file) { skipped++; continue; }
    matched++;
    const newUrl = commonsThumb(file);
    if (d.photo_url === newUrl) continue; // déjà à jour
    const { error: upErr } = await supabase.from("deputies").update({ photo_url: newUrl }).eq("id", d.id);
    if (upErr) { console.warn(`  ✗ ${d.first_name} ${d.last_name}: ${upErr.message}`); continue; }
    updated++;
    if (updated <= 10) console.log(`  ✓ ${d.first_name} ${d.last_name} → ${file}`);
  }

  console.log(`\nTerminé. Correspondances Commons: ${matched} · mises à jour: ${updated} · sans photo Commons (AN conservé): ${skipped}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
