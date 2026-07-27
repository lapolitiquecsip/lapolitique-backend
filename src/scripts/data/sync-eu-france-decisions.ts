import "dotenv/config";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";

// Fil « Décisions de l'UE concernant la France ». Deux sources OFFICIELLES, complémentaires :
//  1) SPARQL Cellar (publications.europa.eu) : les actes juridiques ADRESSÉS À LA FRANCE
//     (décisions aides d'État, Conseil, avis BCE…) — profondeur historique, lien EUR-Lex. Sans clé.
//  2) Flux RSS du press corner de la Commission : la pointe la plus fraîche des communiqués
//     concernant la France. Les deux alimentent la même table (upsert idempotent). Rien d'inventé.
const SPARQL = "https://publications.europa.eu/webapi/rdf/sparql";
const FRA = "http://publications.europa.eu/resource/authority/country/FRA";

async function sparql(query: string): Promise<any[]> {
  const res = await fetch(SPARQL, {
    method: "POST",
    headers: { "Accept": "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 LaPolitiqueBot" },
    body: new URLSearchParams({ query }).toString(),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`SPARQL HTTP ${res.status}`);
  const json = await res.json();
  return json?.results?.bindings || [];
}

const decode = (s: string) => cheerio.load(`<x>${s}</x>`)("x").text().trim();

// Institution qui a PRIS l'acte, détectée en tête de titre (pas dans une citation interne
// comme « règlement (CE) n° 139/2004 du Conseil » qui piégeait la détection).
function institutionOf(title: string): string {
  const t = title.trim().toLowerCase();
  if (/^(arrêt|ordonnance) du tribunal/.test(t)) return "Tribunal de l'Union européenne";
  if (/^(arrêt|ordonnance|conclusions)/.test(t)) return "Cour de justice de l'UE";
  if (/^avis de la banque centrale|^décision.*banque centrale/.test(t)) return "Banque centrale européenne";
  if (/\bdu parlement européen et du conseil\b/.test(t)) return "Parlement européen & Conseil";
  if (/^(décision|règlement|directive|recommandation)[^.]*\bdu conseil\b/.test(t) || /^décision \(ue\)[^.]*\bdu conseil\b/.test(t)) return "Conseil de l'Union européenne";
  if (/^résolution du parlement|^parlement europ/.test(t)) return "Parlement européen";
  return "Commission européenne";
}

function categoryOf(title: string, celex: string): string {
  const t = title.toLowerCase();
  if (/^(arrêt|ordonnance|conclusions)/.test(t)) return "Justice (CJUE)";
  if (/^3\d{4}m/i.test(celex) || /concentration/.test(t)) return "Concentrations";
  if (/aide d.?[ée]tat|compatibilit[ée] avec le march/.test(t)) return "Aides d'État";
  if (/déficit excessif|budg[ée]taire|ressources propres|finance/.test(t)) return "Budget & finances";
  if (/manquement|infraction|recours en/.test(t)) return "Infractions";
  if (/pêche|agricole|agricult/.test(t)) return "Agriculture & pêche";
  if (/aviation|transport|maritime|ferroviaire/.test(t)) return "Transports";
  if (/environnement|climat|émissions|énergie/.test(t)) return "Climat & énergie";
  if (/numérique|données|télécommunications/.test(t)) return "Numérique";
  return "Décision UE";
}

// « Arrêt de la Cour (…) du 4 juin 2026.#MH et Costa Crociere SpA contre X » → lisible.
function cleanTitle(t: string): string {
  return t.replace(/\s*#\s*/g, " — ").replace(/\s+/g, " ").replace(/\.\s*—/g, " —").trim();
}

// --- Source 1 : SPARQL Cellar (relation ?rel entre l'acte et la France) -------------------
async function fromSparql(relation: string, label: string, limit: number): Promise<any[]> {
  const query = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?celex ?date ?title WHERE {
  ?work cdm:${relation} <${FRA}> .
  ?work cdm:resource_legal_id_celex ?celex .
  ?work cdm:work_date_document ?date .
  ?expr cdm:expression_belongs_to_work ?work .
  ?expr cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/FRA> .
  ?expr cdm:expression_title ?title .
} ORDER BY DESC(?date) LIMIT ${limit}`;
  let rows: any[] = [];
  try { rows = await sparql(query); } catch (e) { console.warn(`[sparql ${label}]`, (e as Error).message); return []; }
  const out: any[] = [];
  const seen = new Set<string>();
  for (const b of rows) {
    const celex = b.celex?.value; const title = cleanTitle(b.title?.value || "");
    if (!celex || !title || seen.has(celex)) continue;
    seen.add(celex);
    const date = b.date?.value;
    out.push({
      id: `celex:${celex}`,
      title,
      summary: null,
      url: `https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:${celex}`,
      published_at: date ? new Date(date).toISOString() : null,
      category: categoryOf(title, celex),
      institution: institutionOf(title),
      updated_at: new Date().toISOString(),
    });
  }
  console.log(`> SPARQL ${label} : ${out.length} actes.`);
  return out;
}

// --- Source 2 : législation UE (directives / règlements) qui s'applique en France ---------
// Ces actes sont valables dans TOUS les États membres, France comprise. On les libelle
// clairement (« s'applique en France ») et on écarte les rectificatifs (corrigenda = bruit).
async function fromLegislation(resourceType: string, category: string, label: string, limit: number): Promise<any[]> {
  const query = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?celex ?date ?title WHERE {
  ?work cdm:work_has_resource-type <http://publications.europa.eu/resource/authority/resource-type/${resourceType}> .
  ?work cdm:resource_legal_id_celex ?celex .
  ?work cdm:work_date_document ?date .
  ?expr cdm:expression_belongs_to_work ?work .
  ?expr cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/FRA> .
  ?expr cdm:expression_title ?title .
} ORDER BY DESC(?date) LIMIT ${limit}`;
  let rows: any[] = [];
  try { rows = await sparql(query); } catch (e) { console.warn(`[sparql ${label}]`, (e as Error).message); return []; }
  const out: any[] = [];
  const seen = new Set<string>();
  for (const b of rows) {
    const celex = b.celex?.value; const title = cleanTitle(b.title?.value || "");
    if (!celex || !title || seen.has(celex)) continue;
    if (/R\(\d+\)$/.test(celex) || /^rectificatif/i.test(title)) continue;   // corrigenda = bruit
    seen.add(celex);
    const date = b.date?.value;
    out.push({
      id: `celex:${celex}`, title, summary: null,
      url: `https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:${celex}`,
      published_at: date ? new Date(date).toISOString() : null,
      category, institution: institutionOf(title), updated_at: new Date().toISOString(),
    });
  }
  console.log(`> SPARQL ${label} : ${out.length} actes.`);
  return out;
}

// --- Source 3 : RSS press corner (pointe fraîche, filtrée France) -------------------------
async function fromPressCorner(): Promise<any[]> {
  const FR = /\bfrance\b|fran[çc]ais/i;
  const seen = new Map<string, any>();
  for (const lang of ["fr", "en"]) {
    try {
      const res = await fetch(`https://ec.europa.eu/commission/presscorner/api/rss?language=${lang}&size=25`,
        { headers: { "User-Agent": "Mozilla/5.0 LaPolitiqueBot" }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) continue;
      const $ = cheerio.load(await res.text(), { xmlMode: true });
      $("item").each((_, el) => {
        const e = $(el); const link = (e.find("link").first().text() || "").trim();
        const m = link.match(/detail\/[a-z]{2}\/([a-z]+_\d+_\d+)/i);
        if (!m) return;
        const id = m[1].toLowerCase(); if (id.startsWith("mex_")) return;
        if (!seen.has(id)) seen.set(id, { id, title: decode(e.find("title").first().text() || ""), url: link, pub: (e.find("pubDate").first().text() || "").trim() });
      });
    } catch { /* réseau : on ignore cette vue */ }
  }
  const out: any[] = [];
  for (const it of seen.values()) {
    let summary = "", body = "";
    try {
      const r = await fetch(it.url, { headers: { "User-Agent": "Mozilla/5.0 LaPolitiqueBot" }, signal: AbortSignal.timeout(25000) });
      if (r.ok) { const h = await r.text(); const $ = cheerio.load(h); summary = ($('meta[name="description"]').attr("content") || "").trim(); body = $("body").text(); }
    } catch { /* détail inaccessible */ }
    const concerns = FR.test(it.title) || FR.test(summary) || (body.match(/\bfrance\b|fran[çc]ais/gi) || []).length >= 3;
    if (!concerns) continue;
    out.push({
      id: it.id, title: it.title, summary: summary || null, url: it.url,
      published_at: it.pub ? new Date(it.pub).toISOString() : null,
      category: categoryOf(`${it.title} ${summary}`, ""), institution: "Commission européenne",
      updated_at: new Date().toISOString(),
    });
  }
  console.log(`> Press corner : ${out.length} communiqués concernant la France.`);
  return out;
}

export async function syncEuFranceDecisions() {
  console.log("--- SYNC DÉCISIONS UE CONCERNANT LA FRANCE ---");
  const [caselaw, acts, directives, reglements, press] = await Promise.all([
    fromSparql("case-law_originates_in_country", "CJUE (arrêts France)", 90),   // frais, très pertinent
    fromSparql("resource_legal_addresses_country", "actes adressés à la France", 120),
    fromLegislation("DIR", "Directive (UE)", "directives", 50),                 // législation UE
    fromLegislation("REG", "Règlement (UE)", "règlements", 50),                 // s'applique en France
    fromPressCorner(),
  ]);
  const byId = new Map<string, any>();
  for (const r of [...caselaw, ...acts, ...directives, ...reglements, ...press]) byId.set(r.id, r);
  const rows = [...byId.values()];
  console.log(`> ${rows.length} décisions au total.`);
  if (rows.length) {
    const { error } = await supabase.from("eu_france_decisions").upsert(rows, { onConflict: "id" });
    if (error) { console.error("[eu-france] upsert:", error.message); throw error; }
  }
  console.log(`--- TERMINE. ${rows.length} décisions. ---`);
  return rows.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-eu-france-decisions.ts")) {
  syncEuFranceDecisions().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
