import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Bios riches des eurodéputés — Wikipédia (ancrage factuel) + DeepSeek (rédaction neutre).
// Garde-fou anti-homonyme : l'article doit mentionner « européen / Parlement européen » OU
// le parti national de l'élu. Sinon on ne fabrique rien plutôt qu'une bio du mauvais homonyme.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

async function wikipedia(name: string): Promise<{ extract: string } | null> {
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
    return { extract };
  } catch { return null; }
}

async function writeBio(name: string, party: string, group: string, reference: string): Promise<string | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 6000,
    system: `Tu rédiges un PORTRAIT biographique détaillé et rigoureusement FACTUEL d'un député européen français, UNIQUEMENT à partir du texte de référence Wikipédia fourni. N'invente RIEN.

NEUTRALITÉ ABSOLUE : aucun jugement de valeur, aucun adjectif évaluatif, aucune étiquette idéologique d'auto-description. Uniquement des faits : dates, lieux, fonctions, mandats.

FORME : 3 à 5 paragraphes fluides (origines et formation ; parcours professionnel hors politique ; carrière politique et mandats avec dates ; travaux et engagements au Parlement européen si mentionnés). Français clair, ton encyclopédique. Pas de titre, pas de liste, pas d'introduction méta. Commence directement.

Si le texte de référence est trop maigre, réponds exactement : INSUFFISANT`,
    messages: [{ role: "user", content: `Député européen : ${name} (parti national : ${party}, groupe au PE : ${group}).\n\nTEXTE DE RÉFÉRENCE WIKIPÉDIA :\n${reference.slice(0, 14000)}` }],
  }, { timeoutMs: 120000 });
  const t = (resp.content?.[0]?.text ?? "").trim();
  if (!t || t.length < 200 || /^INSUFFISANT/i.test(t)) return null;
  return t;
}

async function main() {
  const force = process.argv.includes("--force");
  console.log("--- BIOS EURODÉPUTÉS (Wikipédia + IA) ---");
  const { data: meps, error } = await supabase.from("meps").select("id, first_name, last_name, full_name, national_party, ep_group, biography");
  if (error) throw error;
  const todo = (meps ?? []).filter(m => force || !m.biography || m.biography.length < 200);
  console.log(`> ${meps?.length ?? 0} eurodéputés, ${todo.length} à enrichir.`);

  let ok = 0, skip = 0;
  for (const m of todo) {
    const name = (m.full_name || `${m.first_name} ${m.last_name}`).trim();
    try {
      const wiki = await wikipedia(name);
      const ref = wiki?.extract || "";
      const okEuro = /europ[ée]|parlement europ|eurod[ée]put/i.test(ref);
      const okParty = m.national_party && norm(ref).includes(norm(m.national_party));
      if (ref.length < 250 || (!okEuro && !okParty)) {
        skip++; console.log(`  · ${name} : pas d'article fiable, conservé.`); await sleep(300); continue;
      }
      const bio = await writeBio(name, m.national_party || "", m.ep_group || "", ref);
      if (!bio) { skip++; console.log(`  · ${name} : bio insuffisante.`); await sleep(300); continue; }
      const { error: upErr } = await supabase.from("meps").update({ biography: bio }).eq("id", m.id);
      if (upErr) console.warn(`  ! ${name}: ${upErr.message}`);
      else { ok++; console.log(`  ✓ ${name} (${bio.length} car.)`); }
    } catch (e: any) { console.warn(`  ! ${name}: ${e.message}`); }
    await sleep(400);
  }
  console.log(`--- TERMINE. ${ok} enrichies, ${skip} conservées. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
