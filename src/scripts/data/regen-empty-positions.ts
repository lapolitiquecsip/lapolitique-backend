import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { ISSUES } from "./seed-issues.js";

// Régénère les résumés de positions déclaratives VIDES (ou restés en anglais lors d'anciens runs),
// à partir de l'evidence DÉJÀ stockée (intitulés de questions) — sans re-télécharger les sources.
const ISSUE_LABEL = Object.fromEntries(ISSUES.map(i => [i.slug, i.title]));
// Heuristique "résumé en anglais" (mots outils anglais fréquents, absents du français).
const isEnglish = (s: string) => (s.match(/\b(the|senator|raises|issues|and the|of the|for the|about|regarding)\b/gi) || []).length >= 2;

async function main() {
  // Charge toutes les positions (table petite ~2800 lignes).
  const all: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("entity_positions").select("id, entity_type, issue_slug, summary, evidence").range(from, from + 999);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const targets = all.filter(p => !((p.summary || "").trim()) || isEnglish(p.summary || ""));
  console.log(`${all.length} positions · à régénérer (vides ou anglais): ${targets.length}`);

  let done = 0;
  for (const p of targets) {
    const items = Array.isArray(p.evidence) ? p.evidence.map((e: any) => e?.excerpt).filter(Boolean) : [];
    if (!items.length) continue;
    const list = items.slice(0, 12).map((t: string) => `- ${t}`).join("\n");
    try {
      const resp = await resilientDeepSeek.createMessage({
        model: "deepseek-v4-flash", max_tokens: 1200, responseFormat: "json_object",
        system: `À partir des intitulés de QUESTIONS posées au gouvernement par un·e élu·e sur l'enjeu « ${ISSUE_LABEL[p.issue_slug] || p.issue_slug} », résume factuellement CE QUE l'élu·e met en avant.
RÈGLES : n'invente rien au-delà des intitulés ; 2-3 phrases (50 mots max). "stance" = 'inconnu' par défaut ; 'pour'/'contre'/'nuance' seulement si nettement exprimé. Rédige STRICTEMENT en français. Réponds en JSON : { "summary": "...", "stance": "inconnu" }`,
        messages: [{ role: "user", content: `Enjeu : ${ISSUE_LABEL[p.issue_slug] || p.issue_slug}\nQuestions :\n${list}` }],
      });
      const raw = resp.content[0]?.type === "text" ? resp.content[0].text : "";
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) continue;
      const parsed = JSON.parse(m[0]);
      if (!parsed.summary) continue;
      const stance = ["pour", "contre", "nuance", "inconnu"].includes(parsed.stance) ? parsed.stance : "inconnu";
      const { error } = await supabase.from("entity_positions").update({ summary: parsed.summary, stance, updated_at: new Date().toISOString() }).eq("id", p.id);
      if (error) { console.error("update:", error.message); continue; }
      done++;
      if (done % 25 === 0) console.log(`… ${done}`);
    } catch { /* on laisse tel quel */ }
  }
  console.log(`Terminé. ${done} résumés régénérés.`);
}

main().catch(e => { console.error(e); process.exit(1); });
