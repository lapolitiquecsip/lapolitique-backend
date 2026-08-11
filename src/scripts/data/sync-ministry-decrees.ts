import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Brique #4 (enrichissement) — Rattache les DÉCRETS/arrêtés (Journal officiel, déjà en base avec
// résumé) au ministère ÉMETTEUR via le code NOR (les 3 premières lettres = code ministère), et les
// insère comme entrées « action réglementaire » du fil d'actualité de chaque ministère.
// AUCUN appel LLM (les résumés existent déjà) → gratuit.

const slugify = (s: string) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// Code NOR (3 lettres) → mot-clé permettant de retrouver le ministère courant par son nom.
const NOR_MIN: { codes: string[]; kw: RegExp }[] = [
  { codes: ["INT"], kw: /int[ée]rieur/i },
  { codes: ["JUS"], kw: /justice/i },
  { codes: ["EAE", "MAE"], kw: /europe|[ée]trang[èe]res/i },
  { codes: ["ARM", "DEF"], kw: /arm[ée]es|d[ée]fense/i },
  { codes: ["MEN"], kw: /[ée]ducation nationale/i },
  { codes: ["ESR"], kw: /enseignement sup|recherche/i },
  { codes: ["ECO", "ECE", "ECF", "IND"], kw: /[ée]conomie/i },
  { codes: ["CPT", "CPP", "BUD", "ACT"], kw: /action et des comptes|comptes publics/i },
  { codes: ["AGR"], kw: /agriculture/i },
  { codes: ["MTR", "MTS", "TRA", "TRE", "ASO"], kw: /travail|emploi|solidarit/i },
  { codes: ["TEC", "DEV", "TRL", "TRP"], kw: /transition [ée]cologique|[ée]cologie/i },
  { codes: ["TRT", "TRR"], kw: /transports/i },
  { codes: ["SAN", "SSA", "SFH", "SJS", "AFS"], kw: /sant[ée]|familles|autonomie/i },
  { codes: ["LOG", "VLO"], kw: /logement|ville/i },
  { codes: ["TER", "CTR", "ATR"], kw: /am[ée]nagement|territoire|d[ée]centralisation/i },
  { codes: ["MCC", "CUL"], kw: /culture/i },
  { codes: ["SPO", "JEU"], kw: /sports|jeunesse/i },
  { codes: ["OMR", "OME"], kw: /outre-mer/i },
  { codes: ["PME", "COM"], kw: /petites et moyennes|commerce|artisanat/i },
  { codes: ["PRM"], kw: /premier ministre/i },
];

async function main() {
  // Ministères courants → slug (entity_id) via nom.
  const { data: mins, error } = await supabase.from("minister_profiles").select("ministry_name").not("ministry_name", "is", null);
  if (error) throw error;
  const ministries = [...new Map((mins || []).map(m => {
    const name = (m.ministry_name || "").replace(/\s+/g, " ").trim();
    return [slugify(name), name];
  })).entries()].map(([slug, name]) => ({ slug, name }));

  const findSlug = (code3: string): { slug: string } | null => {
    const rule = NOR_MIN.find(r => r.codes.includes(code3));
    if (!rule) return null;
    const m = ministries.find(x => rule.kw.test(x.name));
    return m ? { slug: m.slug } : null;
  };

  // Décrets récents avec résumé.
  const { data: decrees, error: e2 } = await supabase
    .from("decrees")
    .select("nor, title, display_title, summary, source_url, date_publi")
    .not("summary", "is", null)
    .order("date_publi", { ascending: false })
    .limit(600);
  if (e2) throw e2;

  const rows: any[] = [];
  let mapped = 0, unmapped = 0;
  for (const d of decrees || []) {
    const code3 = (d.nor || "").slice(0, 3).toUpperCase();
    const dest = findSlug(code3);
    if (!dest) { unmapped++; continue; }
    mapped++;
    if (!d.source_url) continue;
    rows.push({
      entity_type: "ministry", entity_id: dest.slug,
      source_name: "Journal officiel", source_kind: "jorf",
      url: d.source_url, title: d.display_title || d.title,
      summary: d.summary, news_type: "decret", topic: null,
      published_at: d.date_publi ? new Date(d.date_publi).toISOString() : null,
    });
  }
  console.log(`Décrets : ${mapped} rattachés à un ministère, ${unmapped} non mappés (${rows.length} à écrire).`);

  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await supabase.from("entity_feed").upsert(rows.slice(i, i + 300), { onConflict: "entity_type,entity_id,url" });
    if (error) console.error("upsert:", error.message);
  }
  console.log(`Terminé. ${rows.length} décrets insérés dans le fil des ministères.`);
}

main().catch(e => { console.error(e); process.exit(1); });
