import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Résumé « en clair » de chaque scrutin (Sénat par défaut, ou AN) : une phrase simple et neutre
// expliquant de quoi traite le texte voté, pour que l'utilisateur comprenne le vote de son élu.
// Idempotent (ne traite que les scrutins sans explication), reprenable, à lancer en heures creuses.
//   Usage : npm run data:summarize-scrutins            (Sénat)
//           npm run data:summarize-scrutins -- --chamber=AN
const chamber = (process.argv.find(a => a.startsWith("--chamber="))?.split("=")[1] || "SENAT").toUpperCase();
const LIMIT = Number(process.argv.find(a => a.startsWith("--limit="))?.split("=")[1] || 0);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function explain(title: string): Promise<string | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 900,
    system: `On te donne l'intitulé OFFICIEL d'un scrutin parlementaire français (souvent procédural : « sur la motion… », « sur l'ensemble du projet de loi… »).
Rédige UNE seule phrase courte, simple et NEUTRE (max ~30 mots) expliquant à un citoyen DE QUOI TRAITE le texte concerné et l'enjeu du vote, sans jargon.
- Concentre-toi sur le SUJET de fond du texte, pas sur la procédure.
- Aucun jugement de valeur, aucune orientation politique. Factuel.
- Si l'intitulé ne permet pas d'identifier le sujet, résume simplement l'objet procédural.
Réponds uniquement par la phrase, sans guillemets ni préfixe.`,
    messages: [{ role: "user", content: `Intitulé du scrutin : ${title}` }],
  }, { timeoutMs: 60000 });
  const t = (resp.content?.[0]?.text ?? "").trim().replace(/^«\s*|\s*»$/g, "").replace(/^"|"$/g, "").trim();
  return t.length > 8 ? t : null;
}

async function main() {
  console.log(`--- RÉSUMÉS DES SCRUTINS (${chamber}) ---`);
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("legislative_scrutins")
      .select("id, title, explanation")
      .eq("chamber", chamber)
      .is("explanation", null)
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`> ${rows.length} scrutin(s) à résumer${LIMIT ? ` (limite ${LIMIT})` : ""}.`);

  let ok = 0;
  for (const s of rows) {
    if (LIMIT && ok >= LIMIT) break;
    if (!s.title) continue;
    try {
      const ex = await explain(s.title);
      if (!ex) continue;
      await supabase.from("legislative_scrutins").update({ explanation: ex }).eq("id", s.id);
      ok++;
      if (ok % 25 === 0) console.log(`  … ${ok} faits`);
    } catch (e: any) { console.warn(`  ! ${s.id}: ${e.message}`); }
    await sleep(200);
  }
  console.log(`--- TERMINE. ${ok} résumés générés. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
