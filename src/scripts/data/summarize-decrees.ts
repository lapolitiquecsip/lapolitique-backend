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
    model: "deepseek-chat",
    // Large à dessein, et sans réflexion : le modèle de secours raisonne, et un plafond bas
    // lui faisait rendre une réponse VIDE (tous les jetons partis en raisonnement).
    max_tokens: 700, sansReflexion: true,
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

  const officiel = new Map<string, string>();
  const ids = (rows || []).map((d: any) => d.jorf_id);
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from("jorf_texts").select("id, explication, source_explication").in("id", ids.slice(i, i + 150));
    for (const t of data || []) {
      if (t.explication && t.source_explication !== "renvoi") officiel.set(t.id, t.explication.charAt(0).toUpperCase() + t.explication.slice(1));
    }
  }

  let done = 0;
  for (const d of rows || []) {
    let summary = ruleSummary(d.decree_type, d.title);
    // L'explication du Journal officiel (notice de l'administration, ou résumé tiré du
    // contenu du texte) vaut mieux qu'un résumé deviné d'après le titre : on la prend d'abord.
    if (!summary) summary = officiel.get(d.jorf_id) ?? null;
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
