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

    const rows = ISSUES.filter(issue => !locked.has(issue.slug)).map(issue => {
      const p = positions[issue.slug] || { stance: "inconnu", summary: "" };
      const stance = valid.has(p.stance) ? p.stance : "inconnu";
      return {
        candidate_slug: c.slug, issue_slug: issue.slug, stance,
        summary: stance === "inconnu" ? null : (p.summary || null),
        source_url: url || null, source_type: "wikipedia", updated_at: new Date().toISOString(),
      };
    });
    const { error } = await supabase.from("candidate_positions").upsert(rows, { onConflict: "candidate_slug,issue_slug" });
    if (error) { console.error(`  upsert ${c.full_name}: ${error.message}`); continue; }
    const known = rows.filter(r => r.stance !== "inconnu").length;
    total += known;
    console.log(`> ✓ ${c.full_name} : ${known}/${ISSUES.length} positions documentées`);
  }
  console.log(`--- TERMINE. ${total} positions documentées. ---`);
}

main().catch((e) => { console.error(e); process.exit(1); });
