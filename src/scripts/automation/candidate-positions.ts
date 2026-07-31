import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

const H = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };

// Enjeux formulés comme des propositions Pour/Contre (neutres, largement débattues).
const ISSUES = [
  { slug: "immigration", category: "Régaliens", title: "Immigration", proposition: "Durcir les règles de l'immigration", sort_order: 1 },
  { slug: "securite-justice", category: "Régaliens", title: "Sécurité & justice", proposition: "Renforcer la fermeté pénale (peines plus sévères)", sort_order: 2 },
  { slug: "laicite", category: "Régaliens", title: "Laïcité", proposition: "Renforcer les restrictions sur les signes religieux dans l'espace public", sort_order: 3 },
  { slug: "retraites", category: "Économie & social", title: "Retraites", proposition: "Abroger la réforme portant l'âge légal à 64 ans", sort_order: 4 },
  { slug: "fiscalite", category: "Économie & social", title: "Fiscalité", proposition: "Augmenter les impôts sur les plus hauts patrimoines/revenus", sort_order: 5 },
  { slug: "sante", category: "Économie & social", title: "Santé", proposition: "Augmenter fortement le financement public de la santé", sort_order: 6 },
  { slug: "climat", category: "Écologie & énergie", title: "Climat", proposition: "Imposer des contraintes écologiques fortes (interdictions, normes)", sort_order: 7 },
  { slug: "nucleaire", category: "Écologie & énergie", title: "Nucléaire", proposition: "Développer l'énergie nucléaire", sort_order: 8 },
  { slug: "ukraine-russie", category: "International & institutions", title: "Ukraine / Russie", proposition: "Soutenir militairement l'Ukraine face à la Russie", sort_order: 9 },
  { slug: "europe-ue", category: "International & institutions", title: "Union européenne", proposition: "Approfondir l'intégration européenne", sort_order: 10 },
  { slug: "institutions", category: "International & institutions", title: "Institutions", proposition: "Instaurer la proportionnelle / une VIe République", sort_order: 11 },
];

async function wikiExtract(title: string): Promise<{ extract: string; url?: string }> {
  try {
    const s = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: H, signal: AbortSignal.timeout(12000) });
    if (!s.ok) return { extract: "" };
    const d: any = await s.json();
    let extract = d.extract || "";
    try {
      const f = await fetch(`https://fr.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(d.title || title)}`, { headers: H, signal: AbortSignal.timeout(12000) });
      if (f.ok) { const j: any = await f.json(); const p: any = Object.values(j?.query?.pages ?? {})[0]; if (p?.extract) extract = p.extract; }
    } catch { /* repli */ }
    return { extract, url: d.content_urls?.desktop?.page };
  } catch { return { extract: "" }; }
}

const TAVILY_KEY = process.env.TAVILY_API_KEY || "";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const deacc = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");   // Tavily ne gère pas les accents

// Recherche web (Tavily) de la position d'un·e candidat·e sur UNE proposition précise.
async function tavilyIssue(name: string, proposition: string): Promise<{ context: string; url: string } | null> {
  if (!TAVILY_KEY) return null;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${TAVILY_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: deacc(`${name} ${proposition} position declaration programme vote favorable oppose`), max_results: 6, search_depth: "advanced", include_answer: true }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    const d: any = await res.json();
    const results = (d.results || []).filter((r: any) => r.content).slice(0, 6);
    // La réponse synthétique de Tavily (include_answer) est souvent la plus dense en signal.
    if (d.answer) results.unshift({ title: "Synthèse", url: results[0]?.url || "", content: d.answer });
    if (!results.length) return null;
    return {
      context: results.map((r: any) => `[${r.title || r.url}] ${String(r.content).replace(/\s+/g, " ").slice(0, 600)}`).join("\n\n"),
      url: results[0].url,
    };
  } catch { return null; }
}

// Détermine la position à partir des EXTRAITS WEB (par enjeu), de façon décisive.
async function extractPositionsWeb(name: string, issues: any[], blocks: Record<string, string>): Promise<Record<string, { stance: string; summary: string }>> {
  const issuesText = issues.map(i => `- ${i.slug} : « ${i.proposition} »`).join("\n");
  const ctx = issues.map(i => `### ${i.slug}\n${blocks[i.slug] || "(pas de source)"}`).join("\n\n");
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 4000,
    responseFormat: "json_object",
    system: `On te donne, pour un·e candidat·e à la présidentielle française, des EXTRAITS WEB (presse, déclarations, programme, votes, synthèse) regroupés par proposition. Pour CHAQUE proposition, détermine sa position d'après ces extraits.

MÉTHODE — sois DÉCISIF, ne te réfugie pas dans "inconnu" :
- Déduis la position de TOUT signal explicite : déclaration citée, mesure inscrite au programme, vote au Parlement, ligne de parti que la personne porte, tribune, prise de position publique rapportée. Une position claire mérite "pour" ou "contre", pas "nuance".
- Raisonne par cohérence idéologique DOCUMENTÉE : si les extraits établissent une orientation nette de la personne sur le sujet (ex. écologiste qui combat le nucléaire → "contre" ; gauche sociale qui veut abroger la réforme des retraites → "pour" l'abrogation), tranche.
- "nuance" UNIQUEMENT si les extraits montrent explicitement une position mitigée/conditionnelle (ni franchement pour, ni contre).
- "inconnu" est un DERNIER RECOURS, réservé au cas où les extraits ne contiennent réellement aucun signal exploitable sur ce sujet précis. Ne l'utilise pas par excès de prudence.
- Interdiction d'inventer un fait qui n'est pas dans les extraits ; mais tu PEUX conclure une stance à partir des faits présents.
- "summary" : 1 phrase factuelle et neutre citant l'élément (déclaration/mesure/vote) qui fonde la position (vide seulement si "inconnu").

Réponds en JSON strict : { "positions": { "<slug>": {"stance":"...","summary":"..."} } } pour tous les slugs.`,
    messages: [{ role: "user", content: `Candidat·e : ${name}\n\nPROPOSITIONS :\n${issuesText}\n\nEXTRAITS WEB :\n${ctx.slice(0, 50000)}` }],
  }, { timeoutMs: 120000 });
  const raw = (resp.content?.[0]?.text ?? "").trim();
  try { const j = JSON.parse(raw.startsWith("{") ? raw : raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); return j.positions || {}; } catch { return {}; }
}

async function extractPositions(name: string, extract: string): Promise<Record<string, { stance: string; summary: string }>> {
  const issuesText = ISSUES.map(i => `- ${i.slug} : « ${i.proposition} »`).join("\n");
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 2500,
    responseFormat: "json_object",
    system: `On te donne le TEXTE de référence (Wikipédia) sur une personnalité politique française, et une liste de PROPOSITIONS. Pour CHAQUE proposition, détermine la position de la personne UNIQUEMENT d'après le texte.

RÈGLES STRICTES (fiabilité) :
- N'utilise QUE le texte fourni. N'utilise PAS de connaissances externes, n'invente rien.
- Tu peux déduire la position à partir de FAITS EXPLICITES du texte : votes rapportés, propositions/mesures portées, déclarations citées, actions menées, engagements. Pas seulement des phrases « est pour/contre ».
  Ex. si le texte dit qu'elle a voté contre la réforme des retraites → stance "pour" (favorable à l'abrogation). Si le texte dit qu'il défend le nucléaire → "pour" sur la proposition nucléaire.
- stance = "pour" (favorable à la proposition), "contre" (opposé), "nuance" (position mitigée/conditionnelle explicite), ou "inconnu" si le texte ne dit vraiment rien d'exploitable sur le sujet.
- En cas de doute réel → "inconnu" (ne remplis jamais au hasard).
- "summary" : 1 phrase factuelle et neutre citant l'élément du texte qui fonde la position (vide si inconnu).

Réponds en JSON strict : { "positions": { "<slug>": { "stance": "...", "summary": "..." }, ... } } pour tous les slugs.`,
    messages: [{ role: "user", content: `Personne : ${name}\n\nPROPOSITIONS :\n${issuesText}\n\nTEXTE :\n${extract.slice(0, 55000)}` }],
  }, { timeoutMs: 90000 });
  const raw = resp.content?.[0]?.text?.trim() || "";
  try {
    const j = JSON.parse(raw.startsWith("{") ? raw : raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    return j.positions || {};
  } catch { return {}; }
}

async function main() {
  console.log("--- POSITIONS DES CANDIDATS (sourcé Wikipédia) ---");
  // 1) Enjeux
  for (const i of ISSUES) await supabase.from("issues").upsert(i, { onConflict: "slug" });
  console.log(`> ${ISSUES.length} enjeux à jour.`);

  // 2) Candidats
  const { data: candidates } = await supabase.from("presidential_candidates").select("slug, full_name").eq("status", "declared");
  const valid = new Set(["pour", "contre", "nuance", "inconnu"]);
  let total = 0;
  for (const c of candidates || []) {
    const { extract, url } = await wikiExtract(c.full_name);
    if (!extract) { console.log(`  (pas de Wikipédia pour ${c.full_name})`); continue; }
    let positions: Record<string, { stance: string; summary: string }> = {};
    try { positions = await extractPositions(c.full_name, extract); } catch (e: any) { console.error(`  ${c.full_name}: ${e.message}`); continue; }

    // Ne pas écraser les sources plus fiables (votes réels, programmes officiels).
    const { data: existing } = await supabase.from("candidate_positions").select("issue_slug, source_type").eq("candidate_slug", c.slug);
    const locked = new Set((existing || []).filter((r: any) => r.source_type === "vote" || r.source_type === "programme").map((r: any) => r.issue_slug));

    const rows: any[] = ISSUES.filter(issue => !locked.has(issue.slug)).map(issue => {
      const p = positions[issue.slug] || { stance: "inconnu", summary: "" };
      const stance = valid.has(p.stance) ? p.stance : "inconnu";
      return {
        candidate_slug: c.slug, issue_slug: issue.slug, stance,
        summary: stance === "inconnu" ? null : (p.summary || null),
        source_url: url || null, source_type: "wikipedia", updated_at: new Date().toISOString(),
      };
    });

    // 2ᵉ passe WEB (Tavily) : pour chaque enjeu resté « inconnu », on cherche sur tout le web
    // la position réelle du·de la candidat·e, puis on tranche à partir de ces sources.
    if (TAVILY_KEY) {
      const unknown = rows.filter(r => r.stance === "inconnu");
      const blocks: Record<string, string> = {};
      const webUrl: Record<string, string> = {};
      for (const r of unknown) {
        const issue = ISSUES.find(i => i.slug === r.issue_slug)!;
        const t = await tavilyIssue(c.full_name, issue.proposition);
        if (t) { blocks[r.issue_slug] = t.context; webUrl[r.issue_slug] = t.url; }
        await sleep(120);
      }
      const webIssues = unknown.filter(r => blocks[r.issue_slug]).map(r => ISSUES.find(i => i.slug === r.issue_slug));
      if (webIssues.length) {
        const wp = await extractPositionsWeb(c.full_name, webIssues, blocks).catch(() => ({} as Record<string, any>));
        for (const r of unknown) {
          const p = wp[r.issue_slug];
          if (p && valid.has(p.stance) && p.stance !== "inconnu") {
            r.stance = p.stance; r.summary = p.summary || null;
            r.source_url = webUrl[r.issue_slug] || r.source_url; r.source_type = "web";
          }
        }
      }
    }

    const { error } = await supabase.from("candidate_positions").upsert(rows, { onConflict: "candidate_slug,issue_slug" });
    if (error) { console.error(`  upsert ${c.full_name}: ${error.message}`); continue; }
    const known = rows.filter(r => r.stance !== "inconnu").length;
    total += known;
    console.log(`> ✓ ${c.full_name} : ${known}/${ISSUES.length} positions documentées`);
  }
  console.log(`--- TERMINE. ${total} positions documentées. ---`);
}

main().catch((e) => { console.error(e); process.exit(1); });
