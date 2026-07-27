import "dotenv/config";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";

// Fil « Décisions de l'UE concernant la France » — flux RSS OFFICIEL du press corner de la
// Commission européenne. On récupère les communiqués (type IP = décisions/annonces), on lit le
// détail de chacun, et on NE GARDE que ce qui concerne réellement la France (détection sur
// titre + résumé). Aucune invention : la source officielle est liée sur chaque carte.
// Le flux n'expose que les ~10 derniers communiqués : on interroge plusieurs vues (FR/EN,
// communiqués IP) et le fil s'ACCUMULE dans la table au fil des jours (upsert idempotent).
const RSS = (lang: string, type: string) =>
  `https://ec.europa.eu/commission/presscorner/api/rss?language=${lang}${type ? `&type=${type}` : ""}&size=25`;

const FR_TITLE = /\bfrance\b|\bfran[çc]ais/i;             // France dans le titre = signal fort
const FR_ANY = /\bfrance\b|\bfran[çc]ais/i;

// Classification par mots-clés (titre + résumé).
function classify(text: string): string {
  const t = text.toLowerCase();
  if (/aides? d.?[ée]tat|state aid/.test(t)) return "Aides d'État";
  if (/infraction|mise en demeure|manquement|avis motiv|saisit la cour|proc[ée]dure/.test(t)) return "Infractions";
  if (/million|milliard|paiement|fonds|financ|subvention|d[ée]bours|facilit[ée]/.test(t)) return "Financement";
  if (/num[ée]rique|dsa|dma|donn[ée]es|intelligence artificielle|plateforme/.test(t)) return "Numérique";
  if (/agricult|p[êe]che|alimentaire|pac\b/.test(t)) return "Agriculture & pêche";
  if (/climat|[ée]nergie|environnement|[ée]missions|renouvelable/.test(t)) return "Climat & énergie";
  if (/commerce|sanction|douan|import|export|international/.test(t)) return "Commerce & international";
  if (/transport|infrastructure|rail|a[ée]rien|maritime/.test(t)) return "Transports";
  if (/sant[ée]|m[ée]dicament|vaccin|pharmac/.test(t)) return "Santé";
  return "Autres décisions";
}

const decode = (s: string) => cheerio.load(`<x>${s}</x>`, { xmlMode: false })("x").text().trim();

async function fetchDetail(url: string): Promise<{ summary: string; frCount: number } | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 LaPolitiqueBot" }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const summary = ($('meta[name="description"]').attr("content") || "").trim();
    const bodyText = $("body").text();
    const frCount = (bodyText.match(/\bfrance\b|\bfran[çc]ais/gi) || []).length;
    return { summary, frCount };
  } catch { return null; }
}

export async function syncEuFranceDecisions() {
  console.log("--- SYNC DÉCISIONS UE CONCERNANT LA FRANCE ---");
  const seen = new Map<string, any>();
  const views: Array<[string, string]> = [["fr", ""], ["en", ""], ["fr", "IP"], ["en", "IP"]];
  for (const [lang, type] of views) {
    let xml: string;
    try {
      const res = await fetch(RSS(lang, type), { headers: { "User-Agent": "Mozilla/5.0 LaPolitiqueBot" }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) { console.warn(`RSS ${lang}/${type} HTTP ${res.status}`); continue; }
      xml = await res.text();
    } catch { continue; }
    const $ = cheerio.load(xml, { xmlMode: true });
    $("item").each((_, el) => {
      const e = $(el);
      const link = (e.find("link").first().text() || "").trim();
      const m = link.match(/detail\/[a-z]{2}\/([a-z]+_\d+_\d+)/i);
      if (!m) return;
      const id = m[1].toLowerCase();
      if (id.startsWith("mex_")) return;                     // exclut les « Nouvelles quotidiennes »
      const title = decode(e.find("title").first().text() || "");
      const pub = (e.find("pubDate").first().text() || "").trim();
      if (!seen.has(id)) seen.set(id, { id, title, url: link, published_at: pub ? new Date(pub).toISOString() : null });
    });
  }
  console.log(`> ${seen.size} communiqués candidats.`);

  const rows: any[] = [];
  for (const item of seen.values()) {
    const titleFr = FR_TITLE.test(item.title);
    const detail = await fetchDetail(item.url);
    const summary = detail?.summary || "";
    // Concerne la France si : France dans le titre, OU dans le résumé, OU mentionnée
    // plusieurs fois dans le corps (signal substantiel, pas une mention de passage).
    const concernsFrance = titleFr || FR_ANY.test(summary) || (detail?.frCount ?? 0) >= 3;
    if (!concernsFrance) continue;
    console.log(`  ✔ [${classify(`${item.title} ${summary}`)}] ${item.title.slice(0, 80)}`);
    rows.push({
      id: item.id,
      title: item.title,
      summary: summary || null,
      url: item.url,
      published_at: item.published_at,
      category: classify(`${item.title} ${summary}`),
      institution: "Commission européenne",
      updated_at: new Date().toISOString(),
    });
  }

  console.log(`> ${rows.length} décisions concernant la France retenues.`);
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
