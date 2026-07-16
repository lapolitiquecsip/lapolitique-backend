import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Résumé gratuit (règles) pour Nomination/Distinction ; IA (off-peak) pour Réglementaire.
function ruleSummary(type: string, title: string): string | null {
  if (type === "Nomination")
    return "Décret de nomination : il officialise au Journal officiel l'entrée en fonction ou la promotion de la ou des personnes visées.";
  if (type === "Distinction")
    return "Décret de distinction : il attribue une décoration (Légion d'honneur, ordre national du Mérite, etc.) aux personnes citées.";
  return null;
}

async function aiSummary(title: string): Promise<string | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 220,
    system: `On te donne le TITRE d'un décret publié au Journal officiel. Explique en 2 phrases MAX, en français simple et neutre, ce que sa publication implique concrètement (ce qui change / ce qui est mis en application). Pas d'introduction, pas de jugement. Si le titre ne permet pas d'en dire plus, reformule-le clairement.`,
    messages: [{ role: "user", content: `TITRE : ${title}` }],
  }, { timeoutMs: 45000 });
  const t = resp.content?.[0]?.text?.trim();
  return t && t.length > 10 ? t : null;
}

async function main() {
  console.log("--- RÉSUMÉS DÉCRETS ---");
  const { data: rows, error } = await supabase
    .from("decrees")
    .select("jorf_id, title, decree_type")
    .is("summary", null)
    .order("date_publi", { ascending: false })
    .limit(200);
  if (error) throw error;
  console.log(`> ${rows?.length ?? 0} décret(s) à résumer.`);

  let done = 0;
  for (const d of rows || []) {
    let summary = ruleSummary(d.decree_type, d.title);
    if (!summary) {
      try { summary = await aiSummary(d.title); } catch (e: any) { console.error(`  IA ${d.jorf_id}: ${e.message}`); }
    }
    if (!summary) continue;
    const { error: upErr } = await supabase.from("decrees").update({ summary }).eq("jorf_id", d.jorf_id);
    if (upErr) { console.error(`  update ${d.jorf_id}: ${upErr.message}`); continue; }
    done++;
  }
  console.log(`--- TERMINE. ${done} résumé(s). ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
