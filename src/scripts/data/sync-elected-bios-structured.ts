import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Bio STRUCTURÉE des DÉPUTÉS et SÉNATEURS (mêmes rubriques que les candidats/eurodéputés).
// Ancrage Wikipédia strict, garde-fou anti-homonyme (fonction ou parti). Idempotent et
// reprenable : ne traite que ceux sans bio à la bonne version.
//   Usage : npm run data:sync-deputy-bios    |    npm run data:sync-senator-bios
const which = process.argv.find(a => a === "deputies" || a === "senators") || "deputies";
const CFG = which === "senators"
  ? { table: "senators", roleLabel: "sénateur (Sénat français)", guard: /s[ée]nat/i, version: "sen-1" }
  : { table: "deputies", roleLabel: "député à l'Assemblée nationale", guard: /d[ée]put|assembl[ée]e nationale/i, version: "dep-1" };
const LIMIT = Number((process.argv.find(a => a.startsWith("--limit="))?.split("=")[1]) || 0);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

async function wikipedia(name: string): Promise<string> {
  try {
    const r = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, "_"))}`, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return "";
    const d: any = await r.json();
    if (d.type === "disambiguation") return "";
    let extract = d.extract || "";
    try {
      const full = await fetch(`https://fr.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(d.title || name)}`, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (full.ok) { const j: any = await full.json(); const p: any = Object.values(j?.query?.pages ?? {})[0]; if (p?.extract && p.extract.length > extract.length) extract = p.extract; }
    } catch { /* résumé court */ }
    return extract;
  } catch { return ""; }
}

async function structureBio(name: string, reference: string): Promise<any | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 8000,
    responseFormat: "json_object",
    system: `Tu produis une biographie TRÈS DÉTAILLÉE et rigoureusement FACTUELLE d'un ${CFG.roleLabel}, UNIQUEMENT à partir du texte de référence Wikipédia fourni. N'invente RIEN.

NEUTRALITÉ ABSOLUE : aucun jugement de valeur, aucun qualificatif idéologique, aucun adjectif évaluatif. Faits, dates, fonctions, chiffres.

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
  "realisations": ["actions concrètes par fonction et date (lois, rapports, textes portés, etc.)"],
  "positions": ["principales positions programmatiques, formulées neutrement"],
  "controverses": ["affaires/mises en cause/condamnations avec dates et faits, sans jugement"],
  "chronologie": ["AAAA : événement clé"]
}`,
    messages: [{ role: "user", content: `Personne : ${name} (${CFG.roleLabel})\n\nTexte de référence :\n${reference.slice(0, 40000)}` }],
  }, { timeoutMs: 150000 });
  const text = resp.content?.[0]?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function main() {
  const force = process.argv.includes("--force");
  console.log(`--- BIOS STRUCTURÉES ${CFG.table.toUpperCase()} ---`);
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(CFG.table).select("id, first_name, last_name, party, bio").range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const todo = rows.filter(m => force || !m.bio || (m.bio as any)?._v !== CFG.version);
  console.log(`> ${todo.length}/${rows.length} à (re)structurer${LIMIT ? ` (limite ${LIMIT})` : ""}.`);

  let ok = 0, skip = 0;
  for (const m of todo) {
    if (LIMIT && ok >= LIMIT) break;
    const name = `${m.first_name || ""} ${m.last_name || ""}`.trim();
    try {
      const ref = await wikipedia(name);
      const okRole = CFG.guard.test(ref);
      const okParty = m.party && norm(ref).includes(norm(m.party));
      if (ref.length < 250 || (!okRole && !okParty)) { skip++; console.log(`  · ${name} : pas d'article fiable.`); await sleep(300); continue; }
      const bio = await structureBio(name, ref);
      if (!bio) { skip++; console.log(`  · ${name} : structuration échouée.`); await sleep(300); continue; }
      await supabase.from(CFG.table).update({ bio: { ...bio, _v: CFG.version } }).eq("id", m.id);
      ok++; if (ok % 25 === 0) console.log(`  … ${ok} faites`);
    } catch (e: any) { console.warn(`  ! ${name}: ${e.message}`); }
    await sleep(400);
  }
  console.log(`--- TERMINE. ${ok} structurées, ${skip} sans article. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
