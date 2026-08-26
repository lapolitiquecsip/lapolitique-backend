import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Bio STRUCTURÉE des eurodéputés (rubriques parcours/études/famille/parents/jobs/positions/
// publications/controverses/chronologie…), pour l'affichage en panneaux façon fiches
// candidats. Même prompt neutre et factuel que les candidats. Ancrage Wikipédia strict,
// garde-fou anti-homonyme (« Parlement européen » ou parti national).
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const BIO_VERSION = "mep-1";

async function wikipedia(name: string): Promise<string> {
  try {
    const r = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, "_"))}`,
      { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return "";
    const d: any = await r.json();
    if (d.type === "disambiguation") return "";
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
    return extract;
  } catch { return ""; }
}

async function structureBio(name: string, reference: string): Promise<any | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-chat",
    max_tokens: 8000,
    responseFormat: "json_object",
    system: `Tu produis une biographie TRÈS DÉTAILLÉE et rigoureusement FACTUELLE d'un député européen, UNIQUEMENT à partir du texte de référence Wikipédia fourni. N'invente RIEN.

NEUTRALITÉ ABSOLUE : aucun jugement de valeur, aucun qualificatif idéologique d'auto-description, aucun adjectif évaluatif. Faits, dates, fonctions, chiffres.

EXIGENCES : exhaustif et précis (dates, chiffres, lieux, intitulés). Chaque rubrique est un TABLEAU de points (3 à 8 si l'info existe). Rubrique absente → tableau vide [].

Réponds en JSON strict :
{
  "summary": "accroche 1-2 phrases, factuelle et neutre",
  "naissance": { "date": "AAAA-MM-JJ ou AAAA", "ville": "", "pays": "", "pays_code": "code ISO alpha-2 minuscule" },
  "profession": "métier d'origine hors politique, 2-4 mots, sinon \"\"",
  "formation": "école/diplôme notable, sinon \"\"",
  "enfants": "ex: \"3 enfants\", sinon \"\"",
  "famille": ["..."],
  "parents": ["père...", "mère...", "fratrie..."],
  "etudes": ["diplômes, écoles, années"],
  "parcours": ["toutes les fonctions politiques avec intitulé exact et dates, ordre chronologique"],
  "jobs": ["expériences professionnelles HORS politique, avec dates, ordre chronologique"],
  "publications": ["livres/tribunes écrits par la personne, titre + année"],
  "passions": ["hobbies personnels non politiques"],
  "faits_marquants": ["événements marquants avec dates/chiffres"],
  "realisations": ["actions concrètes par fonction et date (rapports, textes portés au PE, etc.)"],
  "positions": ["principales positions programmatiques, formulées neutrement"],
  "controverses": ["affaires/mises en cause/condamnations avec dates et faits, sans jugement"],
  "chronologie": ["AAAA : événement clé"]
}`,
    messages: [{ role: "user", content: `Député européen : ${name}\n\nTexte de référence :\n${reference.slice(0, 40000)}` }],
  }, { timeoutMs: 150000 });
  const text = resp.content?.[0]?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function main() {
  const force = process.argv.includes("--force");
  console.log("--- BIOS STRUCTURÉES EURODÉPUTÉS ---");
  const { data: meps, error } = await supabase.from("meps").select("id, full_name, national_party, bio");
  if (error) throw error;
  const todo = (meps ?? []).filter(m => force || !m.bio || (m.bio as any)?._v !== BIO_VERSION);
  console.log(`> ${todo.length}/${meps?.length ?? 0} à (re)structurer.`);

  let ok = 0, skip = 0;
  for (const m of todo) {
    try {
      const ref = await wikipedia(m.full_name);
      const okEuro = /europ[ée]|parlement europ|eurod[ée]put/i.test(ref);
      const okParty = m.national_party && norm(ref).includes(norm(m.national_party));
      if (ref.length < 250 || (!okEuro && !okParty)) { skip++; console.log(`  · ${m.full_name} : pas d'article fiable.`); await sleep(300); continue; }
      const bio = await structureBio(m.full_name, ref);
      if (!bio) { skip++; console.log(`  · ${m.full_name} : structuration échouée.`); await sleep(300); continue; }
      await supabase.from("meps").update({ bio: { ...bio, _v: BIO_VERSION } }).eq("id", m.id);
      ok++; console.log(`  ✓ ${m.full_name}`);
    } catch (e: any) { console.warn(`  ! ${m.full_name}: ${e.message}`); }
    await sleep(400);
  }
  console.log(`--- TERMINE. ${ok} structurées, ${skip} sans article. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
