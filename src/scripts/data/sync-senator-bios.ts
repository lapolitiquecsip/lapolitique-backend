import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Bios riches des sénateurs — Wikipédia (ancrage factuel) + DeepSeek (rédaction neutre).
// Remplace la phrase générée par défaut (« X est sénateur (parti) du département Y »).
//
// Garde-fou anti-homonyme (leçon de l'incident « Laurent Nuñez ») : on n'accepte l'article
// Wikipédia que s'il mentionne « sénat/sénateur » OU le département de l'élu. Sinon on ne
// touche PAS à la bio existante — mieux vaut la phrase générique qu'une bio du mauvais homonyme.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

async function wikipedia(name: string): Promise<{ extract: string; title?: string } | null> {
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
    } catch { /* résumé court en repli */ }
    return { extract, title: d.title };
  } catch { return null; }
}

async function writeBio(name: string, party: string, dept: string, reference: string): Promise<string | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-chat",
    max_tokens: 6000,
    system: `Tu rédiges un PORTRAIT biographique détaillé et rigoureusement FACTUEL d'un sénateur français, UNIQUEMENT à partir du texte de référence Wikipédia fourni. N'invente RIEN.

NEUTRALITÉ ABSOLUE : aucun jugement de valeur, aucun adjectif évaluatif (« brillant », « controversé »…), aucune étiquette idéologique d'auto-description. Uniquement des faits : dates, lieux, fonctions, votes, réalisations.

FORME : 3 à 5 paragraphes fluides (origines et formation ; parcours professionnel hors politique ; carrière politique et mandats avec dates ; engagements et travaux parlementaires notables). Français clair, ton encyclopédique neutre. Pas de titre, pas de liste à puces, pas d'introduction méta. Commence directement par le portrait.

Si le texte de référence est trop maigre pour un vrai portrait, réponds exactement : INSUFFISANT`,
    messages: [{ role: "user", content: `Sénateur : ${name} (${party}, ${dept}).\n\nTEXTE DE RÉFÉRENCE WIKIPÉDIA :\n${reference.slice(0, 14000)}` }],
  }, { timeoutMs: 120000 });
  const t = (resp.content?.[0]?.text ?? "").trim();
  if (!t || t.length < 200 || /^INSUFFISANT/i.test(t)) return null;
  return t;
}

async function main() {
  const force = process.argv.includes("--force");
  const limitArg = process.argv.find(a => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;

  console.log("--- BIOS SÉNATEURS (Wikipédia + IA) ---");
  const { data: senators, error } = await supabase
    .from("senators").select("id, first_name, last_name, party, department, biography").order("last_name");
  if (error) throw error;

  // Par défaut on n'enrichit que les bios encore génériques (courtes) ; --force retraite tout.
  let todo = (senators ?? []).filter(s => force || !s.biography || s.biography.length < 200);
  if (limit) todo = todo.slice(0, limit);
  console.log(`> ${senators?.length ?? 0} sénateurs, ${todo.length} à enrichir.`);

  let ok = 0, skipped = 0, failed = 0;
  for (const s of todo) {
    const name = `${s.first_name} ${s.last_name}`.trim();
    try {
      const wiki = await wikipedia(name);
      const ref = wiki?.extract || "";
      // Garde-fou anti-homonyme.
      const ok1 = /s[ée]nat|s[ée]nateur|s[ée]natrice/i.test(ref);
      const ok2 = s.department && norm(ref).includes(norm(s.department));
      if (ref.length < 250 || (!ok1 && !ok2)) { skipped++; console.log(`  · ${name} : pas d'article fiable, conservé tel quel.`); await sleep(300); continue; }

      const bio = await writeBio(name, s.party || "", s.department || "", ref);
      if (!bio) { skipped++; console.log(`  · ${name} : bio jugée insuffisante.`); await sleep(300); continue; }

      const { error: upErr } = await supabase.from("senators").update({ biography: bio }).eq("id", s.id);
      if (upErr) { failed++; console.warn(`  ! ${name} : ${upErr.message}`); }
      else { ok++; console.log(`  ✓ ${name} (${bio.length} car.)`); }
    } catch (e: any) {
      failed++; console.warn(`  ! ${name} : ${e.message}`);
    }
    await sleep(400);
  }
  console.log(`--- TERMINE. ${ok} enrichies, ${skipped} conservées, ${failed} échecs. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
