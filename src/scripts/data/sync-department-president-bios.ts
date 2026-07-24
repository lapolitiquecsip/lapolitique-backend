import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Photo + bio structurée des présidents de département — Wikipédia (photo + ancrage) et
// DeepSeek (rédaction neutre, mêmes rubriques que les eurodéputés/candidats).
// Garde-fou anti-homonyme : l'article doit mentionner le département OU « conseil
// départemental / président du conseil ». Sinon on ne fabrique rien.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const BIO_VERSION = "deppres-1";

async function wikipedia(name: string): Promise<{ extract: string; photo?: string } | null> {
  try {
    const r = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, "_"))}`,
      { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const d: any = await r.json();
    if (d.type === "disambiguation") return null;
    let extract = d.extract || "";
    try {
      const full = await fetch(
        `https://fr.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(d.title || name)}`,
        { headers: UA, signal: AbortSignal.timeout(15000) });
      if (full.ok) {
        const j: any = await full.json();
        const p: any = Object.values(j?.query?.pages ?? {})[0];
        if (p?.extract && p.extract.length > extract.length) extract = p.extract;
      }
    } catch { /* résumé court */ }
    return { extract, photo: d.originalimage?.source || d.thumbnail?.source };
  } catch { return null; }
}

async function structureBio(name: string, dep: string, reference: string): Promise<any | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 8000,
    responseFormat: "json_object",
    system: `Tu produis une biographie TRÈS DÉTAILLÉE et rigoureusement FACTUELLE d'un(e) président(e) de conseil départemental français, UNIQUEMENT à partir du texte Wikipédia fourni. N'invente RIEN.

NEUTRALITÉ ABSOLUE : aucun jugement de valeur, aucun qualificatif idéologique, aucun adjectif évaluatif. Faits, dates, fonctions, chiffres.

EXIGENCES : exhaustif et précis. Chaque rubrique = TABLEAU de points (3 à 8 si l'info existe). Rubrique absente → [].

Réponds en JSON strict :
{
  "summary": "1-2 phrases factuelles et neutres",
  "profession": "métier d'origine hors politique, sinon \"\"",
  "formation": "école/diplôme notable, sinon \"\"",
  "enfants": "ex: \"3 enfants\", sinon \"\"",
  "famille": ["..."], "parents": ["père...", "mère..."], "etudes": ["diplômes, écoles, années"],
  "parcours": ["fonctions politiques avec intitulé exact et dates, ordre chronologique"],
  "jobs": ["expériences professionnelles HORS politique, avec dates"],
  "publications": ["livres/tribunes écrits, titre + année"],
  "passions": ["hobbies personnels non politiques"],
  "faits_marquants": ["événements marquants avec dates/chiffres"],
  "realisations": ["actions concrètes par fonction et date (au département notamment)"],
  "positions": ["principales positions, formulées neutrement"],
  "controverses": ["affaires/mises en cause/condamnations avec dates et faits, sans jugement"],
  "chronologie": ["AAAA : événement clé"]
}`,
    messages: [{ role: "user", content: `Président(e) du conseil départemental (${dep}) : ${name}\n\nTexte de référence :\n${reference.slice(0, 40000)}` }],
  }, { timeoutMs: 150000 });
  const text = resp.content?.[0]?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function main() {
  const force = process.argv.includes("--force");
  console.log("--- PHOTOS + BIOS PRÉSIDENTS DE DÉPARTEMENT ---");
  const { data: pres, error } = await supabase.from("department_presidents").select("dep_code, dep_name, full_name, first_name, last_name, bio, photo_url");
  if (error) throw error;
  const todo = (pres ?? []).filter(p => force || !p.bio || (p.bio as any)?._v !== BIO_VERSION);
  console.log(`> ${todo.length}/${pres?.length ?? 0} à traiter.`);

  let ok = 0, skip = 0;
  for (const p of todo) {
    const name = p.full_name || `${p.first_name} ${p.last_name}`;
    try {
      const wiki = await wikipedia(name);
      const ref = wiki?.extract || "";
      const okDep = p.dep_name && norm(ref).includes(norm(p.dep_name));
      const okFn = /conseil d[ée]partemental|pr[ée]sident du conseil|d[ée]partement/i.test(ref);
      if (ref.length < 250 || (!okDep && !okFn)) { skip++; console.log(`  · ${name} (${p.dep_name}) : pas d'article fiable.`); await sleep(300); continue; }
      const bio = await structureBio(name, p.dep_name || "", ref);
      const update: any = {};
      if (wiki?.photo) update.photo_url = wiki.photo;
      if (bio) { update.bio = { ...bio, _v: BIO_VERSION }; update.biography = bio.summary || null; if (bio.profession) update.party = update.party; }
      if (Object.keys(update).length === 0) { skip++; await sleep(300); continue; }
      await supabase.from("department_presidents").update(update).eq("dep_code", p.dep_code);
      ok++; console.log(`  ✓ ${name} (${p.dep_name})${wiki?.photo ? " +photo" : ""}`);
    } catch (e: any) { console.warn(`  ! ${name}: ${e.message}`); }
    await sleep(400);
  }
  console.log(`--- TERMINE. ${ok} traités, ${skip} sans article. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
