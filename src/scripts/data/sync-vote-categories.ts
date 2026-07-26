import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Catégorisation par DOMAINE des votes du Parlement européen, à partir des classifications
// OFFICIELLES du scrutin (commission responsable, sujets OEIL, concepts EuroVoc, zones
// géographiques, titre). Déterministe et sourcé — aucune invention. Une catégorie principale
// par vote, stockée sur mep_votes pour permettre le filtrage par domaine sur chaque fiche.
const API = "https://howtheyvote.eu/api";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getJson(url: string, tries = 4): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "LaPolitiqueBot/1.0", "Accept": "application/json" }, signal: AbortSignal.timeout(45000) });
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await sleep(1200 * (i + 1)); }
  }
}

// Signal PRIMAIRE : la commission responsable (classification officielle du PE). Chaque
// commission → un domaine. Mapping par sous-chaîne du libellé HowTheyVote.
const COMMITTEE_MAP: Array<[RegExp, string]> = [
  [/foreign affairs|human rights|development/, "Affaires étrangères & Diplomatie"],
  [/security and defence/, "Défense & Sécurité"],
  [/international trade/, "Commerce international"],
  [/agriculture|rural development|fisheries/, "Agriculture & Pêche"],
  [/environment|public health|food safety/, "Environnement & Climat"], // affiné vers Santé plus bas
  [/industry, research and energy/, "Énergie & Industrie"],
  [/employment and social/, "Emploi & Social"],
  [/transport and tourism/, "Transports"],
  [/economic and monetary|budget|budgetary control|regional development/, "Économie & Budget"],
  [/internal market|consumer protection/, "__IMCO__"], // affiné : Numérique si digital, sinon Économie
  [/culture and education/, "Éducation & Culture"],
  [/civil liberties|legal affairs|women'?s rights|gender equality/, "Libertés & Droits fondamentaux"], // affiné vers Migration plus bas
  [/constitutional affairs|petitions/, "Institutions & Démocratie"],
];

// Repli par MOTS-CLÉS quand aucune commission n'est renseignée (résolutions d'urgence, etc.).
// Ordre = priorité. Volontairement spécifique pour éviter les faux positifs.
const KEYWORDS: Array<[RegExp, string]> = [
  [/security and defence|défense|\bdefence\b|military|militaire|armement|\bnato\b|\botan\b|war crimes|weapons? system/, "Défense & Sécurité"],
  [/international trade|commercial policy|trade agreement|tariff|droits de douane|mercosur|customs union|\bwto\b|\bomc\b/, "Commerce international"],
  [/climate|climat|biodivers|greenhouse|carbon|deforest|nature restoration|circular economy|renewable|air quality|water quality|pollution/, "Environnement & Climat"],
  [/\benergy\b|énergie|electricity|nuclear|hydrogen|raw materials|semiconductor|net-zero/, "Énergie & Industrie"],
  [/agricultur|fisher|farming|farmer|common agricultural|livestock|pesticide/, "Agriculture & Pêche"],
  [/tobacco|smoke-|aerosol-free|pharmaceutic|\bhealth\b|\bmedic|\bvaccin|\bcancer|disease outbreak|food safety/, "Santé"],
  [/asylum|migration|refugee|border management|frontex|schengen/, "Migration & Asile"],
  [/artificial intelligence|data protection|cybersecurit|online platform|eprivacy|digital services|digital markets/, "Numérique & Technologies"],
  [/employment|labour market|working conditions|minimum wage|social rights|pension scheme|globalisation adjustment/, "Emploi & Social"],
  [/transport|aviation|maritime safety|railway|road safety/, "Transports"],
  [/taxation|corporation tax|banking union|monetary policy|capital markets|state aid|discharge in respect|budget/, "Économie & Budget"],
  [/education|erasmus|cultural heritage|youth programme/, "Éducation & Culture"],
  [/electoral (act|law)|constitutional|revision of the treaties|rules of procedure/, "Institutions & Démocratie"],
  [/rule of law|press freedom|repression|political prisoner|human rights|arbitrary detention|civil society|death penalty|freedom of expression/, "Libertés & Droits fondamentaux"],
];

function textOf(v: any, ...extra: string[]): string {
  return [
    ...(v.oeil_subjects || []).map((s: any) => s.label || ""),
    ...(v.eurovoc_concepts || []).map((s: any) => s.label || ""),
    ...(v.geo_areas || []).map((s: any) => s.label || ""),
    v.display_title || "", v.description || "", ...extra,
  ].join(" · ").toLowerCase();
}

export function classify(v: any): string {
  const geo = (v.geo_areas || []).map((s: any) => (s.label || "").toLowerCase()).join(" ");
  const title = (v.display_title || "").toLowerCase();
  // 1) Ukraine/Russie : prioritaire (le domaine géopolitique explicite prime).
  if (/ukrain|russia|russie/.test(geo) || /\bukraine\b|against russia|russia'?s war|russian aggression/.test(title))
    return "Ukraine & Russie";

  const t = textOf(v);
  // 2) Commission responsable (signal officiel), avec affinages.
  const comm = (v.responsible_committees || []).map((s: any) => (s.label || "").toLowerCase());
  for (const label of comm) {
    for (const [re, cat] of COMMITTEE_MAP) {
      if (re.test(label)) {
        if (cat === "__IMCO__") return /digital|artificial intelligence|data protection|cyber|online platform|e-commerce/.test(t) ? "Numérique & Technologies" : "Économie & Budget";
        if (cat === "Environnement & Climat" && /tobacco|smoke|health|medic|pharmaceut|vaccin|cancer|disease|food safety|santé/.test(t)) return "Santé";
        if (cat === "Libertés & Droits fondamentaux" && /asylum|migration|refugee|border|frontex|schengen/.test(t)) return "Migration & Asile";
        return cat;
      }
    }
  }
  // 3) Repli mots-clés (pas de commission).
  for (const [re, cat] of KEYWORDS) if (re.test(t)) return cat;
  // 4) Diplomatie si le vote cible un pays tiers (géo hors UE) sans autre signal.
  if (geo.trim() && !/european union|europe$/.test(geo)) return "Affaires étrangères & Diplomatie";
  return "Autres";
}

async function main() {
  const force = process.argv.includes("--force");
  console.log("--- CATÉGORISATION DES VOTES (PE) ---");

  // 1) Votes distincts référencés dans mep_votes, avec l'état de catégorie actuel.
  const seen = new Set<string>(), pending = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("mep_votes").select("vote_id, category").range(from, from + 999);
    if (error) throw error;
    for (const r of (data as any[])) {
      if (seen.has(r.vote_id)) continue;
      seen.add(r.vote_id);
      if (force || !r.category) pending.add(r.vote_id);
    }
    if (!data || data.length < 1000) break;
  }
  console.log(`> ${seen.size} votes distincts, ${pending.size} à catégoriser.`);

  let ok = 0, autres = 0;
  const todo = [...pending];
  for (let i = 0; i < todo.length; i++) {
    const id = todo[i];
    try {
      const v = await getJson(`${API}/votes/${id}`).catch(() => null);
      if (!v || typeof v !== "object") continue;
      const cat = classify(v);
      if (cat === "Autres") autres++;
      // Applique la catégorie à toutes les lignes mep_votes de ce scrutin.
      const { error } = await supabase.from("mep_votes").update({ category: cat }).eq("vote_id", id);
      if (error) { console.warn(`  ! ${id}: ${error.message}`); continue; }
      ok++;
      if (ok % 50 === 0) console.log(`  … ${ok}/${todo.length} (dont ${autres} « Autres »)`);
      await sleep(100);
    } catch (e: any) { console.warn(`  ! ${id}: ${e.message}`); }
  }
  console.log(`--- TERMINE. ${ok} votes catégorisés (${autres} « Autres »). ---`);
}

if (process.argv[1] && process.argv[1].endsWith("sync-vote-categories.ts")) {
  main().catch(e => { console.error(e); process.exit(1); });
}
