import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

const BIO_VERSION = 1;
const H = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };

// Les noms du gouvernement sont en MAJUSCULES → casse correcte pour Wikipédia et l'affichage.
const properCase = (v: string) =>
  v.toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, (_, sep, c) => sep + c.toUpperCase());

const normalizeName = (v: string) =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const slugify = (v: string) =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

async function wikipedia(name: string): Promise<{ extract: string; photo?: string; url?: string }> {
  try {
    const res = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`, { headers: H, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { extract: "" };
    const d: any = await res.json();
    if (d.type === "disambiguation") return { extract: "" };
    let extract = d.extract || "";
    try {
      const f = await fetch(`https://fr.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(d.title || name)}`, { headers: H, signal: AbortSignal.timeout(12000) });
      if (f.ok) { const j: any = await f.json(); const p: any = Object.values(j?.query?.pages ?? {})[0]; if (p?.extract) extract = p.extract; }
    } catch { /* repli */ }
    return { extract, photo: d.originalimage?.source || d.thumbnail?.source, url: d.content_urls?.desktop?.page };
  } catch { return { extract: "" }; }
}

async function structureBio(name: string, ref: string) {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 8000,
    responseFormat: "json_object",
    system: `Tu produis une biographie TRÈS DÉTAILLÉE et rigoureusement FACTUELLE, UNIQUEMENT à partir du texte Wikipédia fourni. N'invente RIEN.

NEUTRALITÉ ABSOLUE : aucun jugement de valeur, aucune étiquette idéologique/auto-description (pas de « gaulliste », « figure de… »). Faits, dates, fonctions, chiffres uniquement.

Réponds en JSON strict :
{
  "summary": "1-2 phrases factuelles neutres",
  "naissance": { "date": "AAAA-MM-JJ ou AAAA", "ville": "", "pays": "", "pays_code": "code ISO alpha-2 minuscules" },
  "profession": "métier d'origine hors politique, 2-4 mots. Sinon \"\"",
  "formation": "école/diplôme notable. Sinon \"\"",
  "enfants": "ex: \"3 enfants\". Sinon \"\"",
  "famille": ["..."],
  "parents": ["..."],
  "etudes": ["diplômes, écoles, années"],
  "parcours": ["TOUTES les fonctions politiques exercées, ordre chronologique, intitulé exact + dates (début–fin)"],
  "jobs": ["expériences professionnelles HORS politique, ordre chronologique, avec dates"],
  "publications": ["livres/essais/tribunes écrits par la personne, titre + année. Sinon []"],
  "faits_marquants": ["événements marquants datés"],
  "realisations": ["actions CONCRÈTES menées, en précisant SOUS QUELLE FONCTION et à QUELLE DATE. Factuel."],
  "positions": ["principales propositions/positions, neutres"],
  "controverses": ["affaires/mises en cause/condamnations, dates et faits, sans jugement"],
  "chronologie": ["AAAA : événement"]
}`,
    messages: [{ role: "user", content: `Personne : ${name}\n\nTexte de référence :\n${ref.slice(0, 45000)}` }],
  }, { timeoutMs: 150000 });
  const raw = resp.content?.[0]?.text ?? "";
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function main() {
  console.log("--- SYNC FICHES MINISTRES (Wikipédia + IA) ---");
  const { data: gov, error } = await supabase.rpc("public_government", { p_date: new Date().toISOString().slice(0, 10) });
  if (error) throw error;
  const members = Array.isArray(gov) ? gov : (gov?.members || []);
  console.log(`> ${members.length} membre(s) du gouvernement.`);

  const { data: existing } = await supabase.from("minister_profiles").select("slug, bio");
  const known = new Map((existing || []).map((r: any) => [r.slug, r.bio]));

  let done = 0;
  for (const mb of members) {
    const fullName = properCase(`${mb.first_name || ""} ${mb.last_name || ""}`.replace(/\s+/g, " ").trim());
    if (!fullName) continue;
    const slug = slugify(fullName);
    if ((known.get(slug) as any)?._v === BIO_VERSION) continue; // déjà à jour

    const wiki = await wikipedia(fullName);
    if (!wiki.extract) { console.log(`  (pas de Wikipédia pour ${fullName})`); continue; }
    const bio = await structureBio(fullName, wiki.extract);

    const { error: upErr } = await supabase.from("minister_profiles").upsert({
      slug, full_name: fullName, normalized_name: normalizeName(fullName),
      ministry_name: mb.ministry_name || null, title: mb.title || null,
      photo_url: wiki.photo || null, summary: bio?.summary || null,
      bio: bio ? { ...bio, _v: BIO_VERSION } : null,
      source_url: wiki.url || null, updated_at: new Date().toISOString(),
    }, { onConflict: "slug" });
    if (upErr) { console.error(`  upsert ${fullName}: ${upErr.message}`); continue; }
    done++;
    console.log(`> ✓ ${fullName}`);
  }
  console.log(`--- TERMINE. ${done} fiche(s) ministre. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
