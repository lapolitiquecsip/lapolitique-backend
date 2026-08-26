import "dotenv/config";
import { createHash } from "crypto";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Résumé « impact citoyen » des lois PROMULGUÉES, pour le livre du Journal Officiel :
// ce que la loi change CONCRÈTEMENT pour le citoyen, formulé « À partir de maintenant… ».
// Basé sur le résumé officiel du dossier (aucune invention). Idempotent (input_hash).
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

async function fetchPromulgated(): Promise<any[]> {
  const out: any[] = [];
  let cursorDate: string | null = null, cursorId: string | null = null;
  for (let page = 0; page < 60; page++) {
    const { data, error } = await supabase.rpc("public_promulgated_laws", {
      p_category: null, p_search: null, p_cursor_date: cursorDate, p_cursor_id: cursorId, p_limit: 100,
    });
    if (error) throw error;
    const rows = (data || []) as any[];
    out.push(...rows);
    if (rows.length < 100) break;
    const last = rows[rows.length - 1];
    cursorDate = last.promulgated_at || last.cursor_date || null;
    cursorId = last.jorf_id || last.official_id || null;
    if (!cursorId) break;
  }
  return out;
}

async function impactOf(title: string, summary: string): Promise<string | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-chat",
    max_tokens: 1200,
    system: `Tu expliques à un citoyen ce qu'une loi PROMULGUÉE (déjà en vigueur) change CONCRÈTEMENT pour lui, à partir du titre et du résumé officiel fournis.

RÈGLES :
- Commence IMPÉRATIVEMENT ta réponse par « À partir de maintenant, ».
- 2 à 4 phrases, français simple et concret : ce qui change pour les gens (droits, obligations, interdictions, aides, sanctions…).
- Reste FACTUEL, fondé sur le résumé. N'invente aucun détail chiffré ou disposition absente du résumé. NEUTRALITÉ : aucun jugement de valeur.
- Réponds UNIQUEMENT par le paragraphe, sans titre ni préambule.`,
    messages: [{ role: "user", content: `Titre : ${title}\n\nRésumé officiel :\n${summary}` }],
  }, { timeoutMs: 90000 });
  let text = (resp.content?.[0]?.text ?? "").trim();
  if (!text) return null;
  // Garantit l'amorce demandée même si le modèle l'a omise.
  if (!/^À partir de maintenant/i.test(text)) text = `À partir de maintenant, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  return text;
}

async function main() {
  const force = process.argv.includes("--force");
  console.log("--- IMPACT CITOYEN DES LOIS PROMULGUÉES ---");
  const laws = await fetchPromulgated();
  console.log(`> ${laws.length} lois promulguées.`);

  const { data: existing } = await supabase.from("law_citizen_impact").select("dossier_id, input_hash");
  const byId = new Map((existing || []).map((r: any) => [r.dossier_id, r.input_hash]));

  let ok = 0, skip = 0;
  for (const law of laws) {
    const summary = (law.summary || "").trim();
    if (!law.id || summary.length < 30) { skip++; continue; }
    const h = hash(summary);
    if (!force && byId.get(law.id) === h) { skip++; continue; }
    try {
      const impact = await impactOf(law.title || "", summary);
      if (!impact) { skip++; continue; }
      await supabase.from("law_citizen_impact").upsert({ dossier_id: law.id, impact, input_hash: h, generated_at: new Date().toISOString() }, { onConflict: "dossier_id" });
      ok++;
      if (ok % 20 === 0) console.log(`  … ${ok} générés`);
      await sleep(150);
    } catch (e: any) { console.warn(`  ! ${law.id}: ${e.message}`); }
  }
  console.log(`--- TERMINE. ${ok} impacts générés, ${skip} inchangés/ignorés. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
