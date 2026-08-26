import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Mots-clés par enjeu → repérer les scrutins pertinents (titre + résumé + objet).
// NB : uniquement les enjeux où un vote mappe SANS AMBIGUÏTÉ à la proposition.
// Europe/institutions/laïcité/fiscalité/santé sont exclus (votes trop indirects → restent sourcés Wikipédia).
const ISSUE_KEYWORDS: Record<string, string[]> = {
  immigration: ["immigration", "étranger", "asile", "séjour", "oqtf", "naturalisation", "regroupement familial", "aide médicale d'état"],
  "securite-justice": ["pénal", "peine", "prison", "délinquance", "récidive", "justice criminelle", "sécurité intérieure"],
  retraites: ["retraite", "âge légal", "64 ans", "abrogation de la réforme des retraites"],
  climat: ["climat", "énergie-climat", "programmation énergie", "émissions de gaz", "artificialisation", "pesticide"],
  nucleaire: ["nucléaire", "epr", "réacteur"],
  "ukraine-russie": ["ukraine", "soutien à l'ukraine", "aide à l'ukraine"],
};

const PROPOSITIONS: Record<string, string> = {
  immigration: "Durcir les règles de l'immigration",
  "securite-justice": "Renforcer la fermeté pénale (peines plus sévères)",
  laicite: "Renforcer les restrictions sur les signes religieux dans l'espace public",
  retraites: "Abroger la réforme portant l'âge légal à 64 ans",
  fiscalite: "Augmenter les impôts sur les plus hauts patrimoines/revenus",
  sante: "Augmenter fortement le financement public de la santé",
  climat: "Imposer des contraintes écologiques fortes (interdictions, normes)",
  nucleaire: "Développer l'énergie nucléaire",
  "ukraine-russie": "Soutenir militairement l'Ukraine face à la Russie",
  "europe-ue": "Approfondir l'intégration européenne",
  institutions: "Instaurer la proportionnelle / une VIe République",
};

const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function issueFor(text: string): string | null {
  const t = norm(text);
  for (const [slug, kws] of Object.entries(ISSUE_KEYWORDS)) {
    if (kws.some(k => t.includes(norm(k)))) return slug;
  }
  return null;
}

async function main() {
  console.log("--- POSITIONS via VOTES RÉELS (candidats députés) ---");

  // Candidats reliés à un député (an_id).
  const { data: candidates } = await supabase.from("presidential_candidates").select("slug, full_name").eq("status", "declared");
  const deputyByCand: Array<{ slug: string; name: string; an_id: string }> = [];
  for (const c of candidates || []) {
    const last = c.full_name.split(/\s+/).pop() || c.full_name;
    const { data: deps } = await supabase.from("deputies").select("first_name,last_name,an_id").ilike("last_name", `%${last}%`);
    const hit = (deps || []).find(d => norm(`${d.first_name} ${d.last_name}`) === norm(c.full_name));
    if (hit?.an_id) deputyByCand.push({ slug: c.slug, name: c.full_name, an_id: hit.an_id });
  }
  console.log(`> ${deputyByCand.length} candidat(s) député(s) : ${deputyByCand.map(d => d.name).join(", ")}`);
  if (!deputyByCand.length) { console.log("Aucun candidat-député."); return; }

  // Index des scrutins (id → contenu) pour retrouver le thème + la source.
  const scrutinById = new Map<string, any>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("scrutins").select("id,objet,title,summary,why_it_matters,dossier_url,date_scrutin").range(from, from + 999);
    if (!data?.length) break;
    for (const s of data) scrutinById.set(s.id, s);
    if (data.length < 1000) break;
  }
  console.log(`> ${scrutinById.size} scrutins indexés.`);

  let total = 0;
  for (const cand of deputyByCand) {
    // Repart d'une base propre : retire les anciennes positions "vote" du candidat
    // (les positions Wikipédia auront été réécrites juste avant par l'autre script).
    await supabase.from("candidate_positions").delete().eq("candidate_slug", cand.slug).eq("source_type", "vote");
    // Votes du candidat.
    const votes: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("deputy_votes").select("scrutin_id,position").eq("deputy_an_id", cand.an_id).range(from, from + 999);
      if (!data?.length) break;
      votes.push(...data);
      if (data.length < 1000) break;
    }
    // Regroupe les votes pertinents par enjeu.
    const byIssue: Record<string, any[]> = {};
    for (const v of votes) {
      if (v.position !== "POUR" && v.position !== "CONTRE") continue;
      const s = scrutinById.get(v.scrutin_id);
      if (!s) continue;
      const slug = issueFor(`${s.title || ""} ${s.objet || ""} ${s.summary || ""} ${s.why_it_matters || ""}`);
      if (!slug) continue;
      (byIssue[slug] ??= []).push({ ...s, position: v.position });
    }

    for (const [slug, list] of Object.entries(byIssue)) {
      // Garde les plus récents, borne à 6 lois par enjeu.
      const laws = list.sort((a, b) => String(b.date_scrutin).localeCompare(String(a.date_scrutin))).slice(0, 6);
      const lawsText = laws.map((l, i) => `${i + 1}. Loi : ${(l.title || l.objet || "").slice(0, 120)} — ce qu'elle fait : ${(l.summary || l.why_it_matters || "").slice(0, 300)} — VOTE : ${l.position}`).join("\n");
      const resp = await resilientDeepSeek.createMessage({
        model: "deepseek-chat",
        max_tokens: 400,
        responseFormat: "json_object",
        system: `On te donne les VOTES RÉELS d'un·e parlementaire sur des lois, avec ce que fait chaque loi, et une PROPOSITION. Déduis sa position sur la proposition à partir de ces votes.

RÈGLES DE FIABILITÉ (très strictes) :
- N'attribue une position (pour/contre/nuance) QUE si AU MOINS UN vote porte sur une loi dont le SUJET CENTRAL EST DIRECTEMENT la proposition (ex: la réforme des retraites pour la proposition sur les retraites ; une loi immigration pour la proposition immigration).
- Si les votes ne sont que TANGENTIELS, indirects ou sur un aspect secondaire (ex: un accord commercial spécifique ne dit rien sur « approfondir l'intégration européenne ») → "inconnu". Dans le doute → "inconnu".
- Ne SURINTERPRÈTE jamais un vote isolé sur une loi technique.
- "summary" : 1 phrase factuelle citant précisément le vote qui fonde la position.

Réponds en français, en JSON : { "stance": "pour|contre|nuance|inconnu", "summary": "...", "law_index": <numéro de la loi la plus représentative> }`,
        messages: [{ role: "user", content: `PROPOSITION : « ${PROPOSITIONS[slug]} »\n\nVOTES :\n${lawsText}` }],
      }, { timeoutMs: 60000 });
      let out: any = {};
      try { const raw = resp.content?.[0]?.text?.trim() || ""; out = JSON.parse(raw.startsWith("{") ? raw : raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { continue; }
      if (!["pour", "contre", "nuance"].includes(out.stance)) continue;
      const src = laws[(Number(out.law_index) || 1) - 1] || laws[0];
      const { error } = await supabase.from("candidate_positions").upsert({
        candidate_slug: cand.slug, issue_slug: slug, stance: out.stance,
        summary: out.summary || null, source_url: src?.dossier_url || null, source_type: "vote",
        updated_at: new Date().toISOString(),
      }, { onConflict: "candidate_slug,issue_slug" });
      if (error) { console.error(`  ${cand.name}/${slug}: ${error.message}`); continue; }
      total++;
    }
    console.log(`> ✓ ${cand.name} : positions votées mises à jour`);
  }
  console.log(`--- TERMINE. ${total} positions (votes) écrites. ---`);
}

main().catch((e) => { console.error(e); process.exit(1); });
