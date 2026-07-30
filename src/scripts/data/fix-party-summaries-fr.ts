import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Corrige les résumés de partis rédigés par erreur en anglais : détection puis réécriture en
// français neutre via DeepSeek. Idempotent (ne retouche que ceux détectés en anglais).
const ENGLISH = /\bthe\b|\bis a\b|\bhas been\b|founded in|political party|\band\b|\bwith\b/i;

async function toFrench(name: string, text: string): Promise<string | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 400,
    system: `Traduis/réécris en FRANÇAIS clair et neutre ce résumé de parti politique, en 2-3 phrases. Aucune phrase en anglais. Pas d'introduction, uniquement le résumé.`,
    messages: [{ role: "user", content: `Parti : ${name}\nTexte : ${text}` }],
  }, { timeoutMs: 45000 });
  const t = resp.content?.[0]?.text?.trim();
  return t && t.length > 15 ? t : null;
}

async function main() {
  console.log("--- CORRECTION RÉSUMÉS PARTIS (FR) ---");
  const { data, error } = await supabase.from("political_parties").select("slug, name, summary");
  if (error) throw error;
  const targets = (data || []).filter((p: any) => p.summary && ENGLISH.test(p.summary));
  console.log(`> ${targets.length} résumés en anglais à corriger.`);
  let ok = 0;
  for (const p of targets as any[]) {
    let fr: string | null = null;
    try { fr = await toFrench(p.name, p.summary); } catch (e: any) { console.error(`  IA ${p.slug}: ${e.message}`); }
    if (!fr) continue;
    const { error: upErr } = await supabase.from("political_parties").update({ summary: fr }).eq("slug", p.slug);
    if (upErr) { console.error(`  update ${p.slug}: ${upErr.message}`); continue; }
    console.log(`  ✔ ${p.name}`);
    ok++;
  }
  console.log(`--- TERMINE. ${ok}/${targets.length} corrigés. ---`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
