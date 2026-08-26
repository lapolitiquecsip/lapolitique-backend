import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Génère les données VISUELLES de l'analyse détaillée d'une loi (essence / avant-après /
// impacts chiffrés / vote), pour l'affichage « design premium ». On RESTRUCTURE l'analyse
// premium EXISTANTE (legislative_analyses.summary) — sans rien inventer ni ajouter de fait.
// Les chiffres de vote viennent des scrutins officiels (legislative_scrutins). Idempotent :
// ne (re)génère que les analyses sans `visual` (ou d'une version antérieure).

const VISUAL_VERSION = 1;
const BATCH = Number(process.env.LAW_VISUAL_BATCH || 60);

const SYS = `On te donne l'ANALYSE EXISTANTE d'une loi française (texte structuré). Tu la RESTRUCTURES pour un affichage visuel, SANS RIEN INVENTER ni ajouter le moindre fait, chiffre ou détail absent du texte fourni.

Réponds en JSON STRICT :
{
  "essence": "1 à 2 phrases : ce que fait concrètement la loi (reformulé à partir du texte, neutre et factuel)",
  "avant_apres": [ { "avant": "situation/règle AVANT (uniquement si le texte la mentionne)", "apres": "ce que la loi change" } ],
  "impacts": [ { "value": "un CHIFFRE ou une donnée présent DANS LE TEXTE (ex: « 15 h », « 2 millions », « +450 € »)", "label": "ce que ce chiffre représente" } ]
}

RÈGLES STRICTES :
- N'invente AUCUN chiffre. Les "value" doivent apparaître (ou être directement déductibles) dans le texte fourni. Si aucun chiffre marquant, "impacts": [].
- "avant_apres" UNIQUEMENT si un changement avant→après est clair dans le texte. Sinon [].
- Max 3 avant_apres, max 3 impacts. Court, factuel, neutre. En français.`;

async function fetchAll(table: string, select: string, apply: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await apply(supabase.from(table).select(select)).range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function extractVisual(text: string): Promise<any | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-chat", max_tokens: 1500, responseFormat: "json_object",
    system: SYS, messages: [{ role: "user", content: text.slice(0, 12000) }],
  }, { timeoutMs: 90000 });
  const t = resp.content[0]?.text ?? "";
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return {
      essence: typeof j.essence === "string" ? j.essence.slice(0, 400) : null,
      avant_apres: Array.isArray(j.avant_apres) ? j.avant_apres.filter((x: any) => x?.avant && x?.apres).slice(0, 3) : [],
      impacts: Array.isArray(j.impacts) ? j.impacts.filter((x: any) => x?.value && x?.label).slice(0, 3) : [],
    };
  } catch { return null; }
}

export async function generateLawVisual() {
  console.log("--- ANALYSE VISUELLE DES LOIS (design premium) ---");

  // 1) Analyses premium sans `visual` (ou version < courante).
  let rows: any[];
  try {
    rows = await fetchAll("legislative_analyses", "id, dossier_id, summary, visual",
      q => q.eq("audience", "premium").not("summary", "is", null));
  } catch (e: any) {
    if (/visual|column .* does not exist/i.test(e.message)) {
      console.log("  ! colonne legislative_analyses.visual absente — appliquer la migration. Étape ignorée.");
      return 0;
    }
    throw e;
  }
  const todo = rows.filter(r => !r.visual || (r.visual as any)._v !== VISUAL_VERSION).slice(0, BATCH);
  console.log(`> ${rows.length} analyses premium, ${todo.length} à traiter (lot ${BATCH}).`);
  if (!todo.length) { console.log("--- Rien à faire. ---"); return 0; }

  // 2) Chiffres de vote officiels par dossier (dernier scrutin décisif).
  const dossierIds = [...new Set(todo.map(r => r.dossier_id))];
  const voteByDossier = new Map<string, any>();
  for (let i = 0; i < dossierIds.length; i += 200) {
    const scr = await fetchAll("legislative_scrutins", "dossier_id, result_label, for_count, against_count, abstain_count, voted_at",
      q => q.in("dossier_id", dossierIds.slice(i, i + 200)).order("voted_at", { ascending: false }));
    for (const s of scr) if (!voteByDossier.has(s.dossier_id)) voteByDossier.set(s.dossier_id, s); // le plus récent
  }

  // 3) Extraction + stockage.
  let done = 0;
  for (const r of todo) {
    try {
      const v = await extractVisual(r.summary);
      if (!v) { console.warn(`  ! extraction vide (dossier ${r.dossier_id})`); continue; }
      const sc = voteByDossier.get(r.dossier_id);
      const vote = sc && (sc.for_count != null || sc.against_count != null)
        ? { pour: sc.for_count ?? 0, contre: sc.against_count ?? 0, abstention: sc.abstain_count ?? 0, result: sc.result_label ?? null }
        : null;
      const visual = { ...v, vote, _v: VISUAL_VERSION };
      const { error } = await supabase.from("legislative_analyses").update({ visual }).eq("id", r.id);
      if (error) { console.error(`  ! update ${r.id}: ${error.message}`); continue; }
      done++;
    } catch (err: any) {
      console.error(`  ! ${r.dossier_id}: ${err.message}`);
    }
  }
  console.log(`--- TERMINE. ${done} analyse(s) visuelle(s) générée(s). ---`);
  return done;
}

if (process.argv[1] && process.argv[1].endsWith("generate-law-visual.ts")) {
  generateLawVisual().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
