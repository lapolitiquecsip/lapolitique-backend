import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Brique #4 — Seed du registre des flux d'actualité par entité (ministères + départements).
// Génère un flux Google News par entité (gratuit, réutilisable : on ne stocke que titre/lien +
// résumé IA court). Les salles de presse RSS officielles pourront être ajoutées ensuite dans
// entity_feed_sources (kind='official_rss') sans toucher au pipeline. Idempotent.

// slugify ALIGNÉ sur la route front /executif/ministere/[slug] (même normalisation).
const slugify = (s: string) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const gnews = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`;

type Source = { entity_type: string; entity_id: string; entity_name: string; feed_url: string; source_name: string; kind: string; active: boolean };

// Requête Google News orientée ACTION (annonces, mesures, décrets…) — évite le pur commentaire.
const gnewsAction = (name: string) =>
  gnews(`"${name}" (annonce OR mesure OR décret OR arrêté OR plan OR réforme OR lance OR déploie OR budget OR nomination)`);

// RSS d'actualités OFFICIELS vérifiés, rattachés par mot-clé du nom du ministère (robuste aux
// remaniements). Voix authentique du ministère → son action réelle.
const OFFICIAL_RSS: { kw: RegExp; url: string; source: string }[] = [
  { kw: /travail|emploi/i, url: "https://travail-emploi.gouv.fr/rss.xml", source: "Ministère du Travail" },
  { kw: /agriculture/i, url: "https://agriculture.gouv.fr/rss.xml", source: "Ministère de l'Agriculture" },
  { kw: /justice/i, url: "https://www.justice.gouv.fr/rss.xml", source: "Ministère de la Justice" },
  { kw: /enseignement sup|recherche/i, url: "https://www.enseignementsup-recherche.gouv.fr/rss.xml", source: "Enseignement supérieur & Recherche" },
  { kw: /sant[ée]/i, url: "https://sante.gouv.fr/rss.xml", source: "Ministère de la Santé" },
];

async function ministries(): Promise<Source[]> {
  const { data, error } = await supabase.from("minister_profiles").select("ministry_name").not("ministry_name", "is", null);
  if (error) throw error;
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const r of data || []) {
    const name = (r.ministry_name || "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const id = slugify(name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // 1) RSS officiel du ministère si disponible (prioritaire, action authentique).
    const rss = OFFICIAL_RSS.find(o => o.kw.test(name));
    if (rss) out.push({ entity_type: "ministry", entity_id: id, entity_name: name, feed_url: rss.url, source_name: rss.source, kind: "official_rss", active: true });
    // 2) Google News orienté action (couverture large + fallback).
    out.push({ entity_type: "ministry", entity_id: id, entity_name: name, feed_url: gnewsAction(name), source_name: "Google News", kind: "google_news", active: true });
  }
  return out;
}

async function departments(): Promise<Source[]> {
  const { data, error } = await supabase.from("department_presidents").select("dep_code, dep_name").not("dep_code", "is", null);
  if (error) throw error;
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const r of data || []) {
    const code = (r.dep_code || "").trim();
    const name = (r.dep_name || "").trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    // Conseil départemental (élus) — action de la collectivité.
    out.push({ entity_type: "department", entity_id: code, entity_name: name, feed_url: gnews(`conseil départemental "${name}"`), source_name: "Google News", kind: "google_news", active: true });
    // Préfecture (État) — actions/arrêtés préfectoraux. Pas de RAA en open data national → Google News
    // ciblé sur l'action préfectorale (arrêtés : sécheresse, circulation, sécurité, manifestations…).
    out.push({ entity_type: "department", entity_id: code, entity_name: name, feed_url: gnews(`(préfecture OR préfet OR "arrêté préfectoral") "${name}" (arrêté OR interdit OR autorise OR restriction OR mesure OR sécheresse)`), source_name: "Préfecture", kind: "google_news", active: true });
  }
  return out;
}

// Brique #1 — communes de plus de 20 000 habitants (support = fiches maires). Google News ciblé
// sur la vie municipale (mairie/conseil municipal/travaux/projet) pour limiter les homonymes.
async function communesTop(): Promise<Source[]> {
  const out: Source[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("mayors").select("insee_code, commune_name, population").gte("population", 10000).order("population", { ascending: false }).range(from, from + 999);
    if (error) throw error;
    for (const r of data || []) {
      const insee = (r.insee_code || "").trim(); const name = (r.commune_name || "").trim();
      if (!insee || !name) continue;
      out.push({ entity_type: "commune", entity_id: insee, entity_name: name, feed_url: gnews(`"${name}" (mairie OR municipal OR "conseil municipal" OR travaux OR projet OR urbanisme)`), source_name: "Google News", kind: "google_news", active: true });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  const sources = [...await ministries(), ...await departments(), ...await communesTop()];
  console.log(`→ ${sources.length} sources (${sources.filter(s => s.entity_type === "ministry").length} ministères, ${sources.filter(s => s.entity_type === "department").length} départements, ${sources.filter(s => s.entity_type === "commune").length} communes).`);
  let ok = 0;
  for (let i = 0; i < sources.length; i += 200) {
    const batch = sources.slice(i, i + 200);
    const { error } = await supabase.from("entity_feed_sources").upsert(batch, { onConflict: "entity_type,entity_id,feed_url" });
    if (error) { console.error("upsert:", error.message); continue; }
    ok += batch.length;
  }
  console.log(`Terminé. ${ok} sources enregistrées/à jour.`);
  console.log("Aperçu ministères :", sources.filter(s => s.entity_type === "ministry").slice(0, 8).map(s => s.entity_id).join(", "));
}

main().catch(e => { console.error(e); process.exit(1); });
