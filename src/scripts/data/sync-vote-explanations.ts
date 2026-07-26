import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Explications pédagogiques des votes du Parlement européen (DeepSeek), à partir des
// métadonnées OFFICIELLES du scrutin (HowTheyVote). Une explication par vote, réutilisée
// sur la fiche de chaque eurodéputé. Automatisé : ne (re)génère que les votes manquants.
//
// Périmètre par défaut : les votes PRINCIPAUX (is_main) référencés dans mep_votes — ceux que
// les utilisateurs voient et cliquent. Réglable via --all pour couvrir tous les scrutins.
const API = "https://howtheyvote.eu/api";
const BIO_V = 1;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getJson(url: string, tries = 4): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "LaPolitiqueBot/1.0", "Accept": "application/json" }, signal: AbortSignal.timeout(45000) });
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await sleep(1200 * (i + 1)); }
  }
}

async function explain(v: any): Promise<{ subject: string; explanation: string; stakes: string } | null> {
  const ctx = [
    `Titre : ${v.display_title || v.title || ""}`,
    v.reference ? `Référence : ${v.reference}` : "",
    v.description ? `Description : ${v.description}` : "",
    v.procedure_title ? `Procédure : ${v.procedure_title}` : "",
    (v.oeil_subjects?.length ? `Domaines (OEIL) : ${v.oeil_subjects.map((s: any) => s.label || s).join(", ")}` : ""),
    (v.eurovoc_concepts?.length ? `Concepts (EuroVoc) : ${v.eurovoc_concepts.map((s: any) => s.label || s).join(", ")}` : ""),
    (v.geo_areas?.length ? `Zones géographiques : ${v.geo_areas.map((s: any) => s.label || s).join(", ")}` : ""),
    (v.responsible_committees?.length ? `Commissions : ${v.responsible_committees.map((s: any) => s.label || s.abbreviation || s).join(", ")}` : ""),
    v.result ? `Résultat : ${v.result}` : "",
  ].filter(Boolean).join("\n");

  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 2500,
    responseFormat: "json_object",
    system: `Tu expliques à un citoyen non spécialiste un vote du Parlement européen, à partir UNIQUEMENT des métadonnées officielles fournies. Sois clair, concret et FACTUEL. N'invente aucun chiffre ni détail absent des métadonnées. NEUTRALITÉ absolue : aucun jugement de valeur, aucune orientation partisane. Français simple.

Réponds en JSON strict :
{
  "subject": "En UNE phrase, de quoi traite ce texte (le sujet concret).",
  "explanation": "3 à 5 phrases : explique l'enjeu concret et le contexte, en langage accessible. Ce que le texte propose/vise, pourquoi ça compte pour les citoyens. Pas de jargon non expliqué.",
  "stakes": "1 à 2 phrases : ce que l'adoption (ou le rejet) de ce texte change concrètement."
}`,
    messages: [{ role: "user", content: `Métadonnées du scrutin :\n${ctx}` }],
  }, { timeoutMs: 90000 });
  const text = resp.content?.[0]?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { const j = JSON.parse(m[0]); return { subject: j.subject || "", explanation: j.explanation || "", stakes: j.stakes || "" }; }
  catch { return null; }
}

async function main() {
  const all = process.argv.includes("--all");
  const limit = Number(process.argv.find(a => a.startsWith("--limit="))?.split("=")[1] || 0);
  console.log(`--- EXPLICATIONS DE VOTES (${all ? "tous" : "principaux"}) ---`);

  // 1) Votes distincts référencés dans mep_votes (pagination Supabase).
  const ids = new Map<string, { title: string; reference: string | null }>();
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("mep_votes").select("vote_id, title, reference, is_main").range(from, from + 999);
    if (!all) q = q.eq("is_main", true);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of (data as any[])) if (!ids.has(r.vote_id)) ids.set(r.vote_id, { title: r.title, reference: r.reference });
    if (!data || data.length < 1000) break;
  }
  console.log(`> ${ids.size} votes distincts.`);

  // 2) Déjà expliqués (à jour) → à exclure.
  const done = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("vote_explanations").select("vote_id, bio_v").range(from, from + 999);
    for (const r of (data as any[]) || []) if (r.bio_v === BIO_V) done.add(r.vote_id);
    if (!data || data.length < 1000) break;
  }
  let todo = [...ids.keys()].filter(id => !done.has(id));
  if (limit > 0) todo = todo.slice(0, limit);
  console.log(`> ${todo.length} à générer.`);

  let ok = 0, skip = 0;
  for (const id of todo) {
    try {
      const detail = await getJson(`${API}/votes/${id}`).catch(() => null);
      const v = detail?.result || detail || { display_title: ids.get(id)!.title, reference: ids.get(id)!.reference };
      const ex = await explain(v);
      if (!ex || !ex.explanation) { skip++; continue; }
      await supabase.from("vote_explanations").upsert({
        vote_id: id,
        title: (v.display_title || ids.get(id)!.title || "").slice(0, 400),
        reference: v.reference || ids.get(id)!.reference || null,
        subject: ex.subject, explanation: ex.explanation, stakes: ex.stakes,
        bio_v: BIO_V, generated_at: new Date().toISOString(),
      }, { onConflict: "vote_id" });
      ok++;
      if (ok % 25 === 0) console.log(`  … ${ok} générées`);
      await sleep(150);
    } catch (e: any) { console.warn(`  ! ${id}: ${e.message}`); }
  }
  console.log(`--- TERMINE. ${ok} explications générées, ${skip} sans contenu. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
