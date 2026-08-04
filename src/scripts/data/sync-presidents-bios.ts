import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Fiches des présidents de la République : bio structurée TRÈS détaillée (mêmes rubriques que les
// élus), ancrée Wikipédia, neutre. Idempotent (BIO_VERSION). Photo depuis Wikipédia.
const BIO_VERSION = "pres-1";
const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const PRESIDENTS = [
  { slug: "emmanuel-macron", full_name: "Emmanuel Macron", term: "depuis 2017", party: "Renaissance", sort_order: 1 },
  { slug: "francois-hollande", full_name: "François Hollande", term: "2012–2017", party: "Parti socialiste", sort_order: 2 },
  { slug: "nicolas-sarkozy", full_name: "Nicolas Sarkozy", term: "2007–2012", party: "UMP", sort_order: 3 },
];

async function wikipedia(name: string): Promise<{ extract: string; photo?: string; url?: string }> {
  const s = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, "_"))}`, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!s.ok) return { extract: "" };
  const d: any = await s.json();
  let extract = d.extract || "";
  try {
    const f = await fetch(`https://fr.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(d.title || name)}`, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (f.ok) { const j: any = await f.json(); const p: any = Object.values(j?.query?.pages ?? {})[0]; if (p?.extract && p.extract.length > extract.length) extract = p.extract; }
  } catch { /* résumé court */ }
  return { extract, photo: d.originalimage?.source || d.thumbnail?.source, url: d.content_urls?.desktop?.page };
}

async function structureBio(name: string, reference: string): Promise<any | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 24000,
    responseFormat: "json_object",
    system: `Tu produis une biographie TRÈS DÉTAILLÉE et rigoureusement FACTUELLE d'un président de la République française, UNIQUEMENT à partir du texte de référence Wikipédia fourni. N'invente RIEN.
NEUTRALITÉ ABSOLUE : aucun jugement de valeur, aucun qualificatif idéologique, aucun adjectif évaluatif. Faits, dates, fonctions, chiffres.
EXIGENCES : exhaustif et précis (dates, chiffres, lieux, intitulés). Chaque rubrique est un TABLEAU de points (3 à 8 si l'info existe). Rubrique absente → [].
Réponds en JSON strict :
{ "summary":"accroche 1-2 phrases, factuelle et neutre",
  "naissance":{"date":"AAAA-MM-JJ ou AAAA","ville":"","pays":"","pays_code":"code ISO alpha-2 minuscule"},
  "profession":"métier d'origine hors politique, 2-4 mots, sinon \"\"", "formation":"école/diplôme notable, sinon \"\"",
  "enfants":"ex: \"2 enfants\", sinon \"\"", "famille":[], "parents":[], "etudes":[],
  "parcours":["toutes les fonctions politiques avec intitulé exact et dates, ordre chronologique"],
  "jobs":["expériences professionnelles HORS politique, avec dates"],
  "publications":["livres/tribunes, titre + année"], "passions":["hobbies personnels non politiques"],
  "faits_marquants":["événements marquants avec dates/chiffres"],
  "realisations":["actions concrètes menées durant la présidence et les fonctions précédentes (lois, réformes, décisions), avec dates"],
  "positions":["principales orientations et positions, formulées neutrement"],
  "controverses":["affaires/mises en cause/condamnations avec dates et faits, sans jugement"],
  "chronologie":["AAAA : événement clé"] }`,
    messages: [{ role: "user", content: `Personne : ${name} (président de la République française)\n\nTexte de référence :\n${reference.slice(0, 45000)}` }],
  }, { timeoutMs: 150000 });
  const text = (resp.content?.[0]?.text ?? "").replace(/```json\s*|\s*```/g, "").trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function main() {
  const force = process.argv.includes("--force");
  console.log("--- FICHES PRÉSIDENTS ---");
  const { data: existing } = await supabase.from("presidents").select("slug, bio");
  const done = new Map((existing || []).map((r: any) => [r.slug, r.bio]));
  let ok = 0;
  for (const p of PRESIDENTS) {
    if (!force && (done.get(p.slug) as any)?._v === BIO_VERSION) { console.log(`  · ${p.full_name} : déjà à jour.`); continue; }
    try {
      const wiki = await wikipedia(p.full_name);
      if (!wiki.extract) { console.log(`  ! ${p.full_name} : pas d'article.`); continue; }
      const bio = await structureBio(p.full_name, wiki.extract);
      if (!bio) { console.log(`  ! ${p.full_name} : structuration échouée.`); continue; }
      await supabase.from("presidents").upsert({
        slug: p.slug, full_name: p.full_name, term: p.term, party: p.party, sort_order: p.sort_order,
        photo_url: wiki.photo || null, source_url: wiki.url || null,
        bio: { ...bio, _v: BIO_VERSION }, summary: bio.summary || null, updated_at: new Date().toISOString(),
      }, { onConflict: "slug" });
      ok++;
      console.log(`  ✓ ${p.full_name}`);
    } catch (e: any) { console.warn(`  ! ${p.full_name}: ${e.message}`); }
    await sleep(400);
  }
  console.log(`--- TERMINE. ${ok} fiche(s) générée(s). ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
