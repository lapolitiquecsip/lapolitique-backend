import "dotenv/config";
import { createHash } from "crypto";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Titres SYNTHÉTISÉS (façon Datan) des dossiers législatifs : un titre court et clair à la
// place de l'intitulé officiel long. Uniquement quand le titre est long (> MIN_LEN). Basé
// sur le titre officiel — aucune invention de contenu. Périmètre : lois promulguées + textes
// en cours (AN/Sénat), c.-à-d. ce que l'utilisateur voit dans les listes.
const MIN_LEN = 60;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

async function fetchAll(apply: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await apply(supabase.from("legislative_dossiers").select("id, title")).range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function shorten(title: string): Promise<string | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 400,
    system: `Tu synthétises l'intitulé officiel (souvent long) d'un texte de loi français en un TITRE COURT, clair et neutre, façon titre de presse.

RÈGLES :
- 4 à 9 mots maximum. Garde le SUJET concret et l'action principale.
- Neutre et factuel : aucun jugement, aucune invention. Fidèle au titre fourni.
- Pas de guillemets, pas de point final, pas de préambule. Réponds UNIQUEMENT par le titre court.

Exemples :
- « Interdire l'importation en France de produits agricoles contenant de l'acétamipride et abroger la loi visant à lever les contraintes à l'exercice du métier d'agriculteur » → Acétamipride : importation et contraintes agricoles
- « Proposition de loi visant à reconnaître une présomption de légitime défense pour les forces de l'ordre dans l'exercice de leurs fonctions » → Présomption de légitime défense pour les forces de l'ordre`,
    messages: [{ role: "user", content: title }],
  }, { timeoutMs: 60000 });
  let t = (resp.content?.[0]?.text ?? "").trim().replace(/^["«»\s]+|["«»\s.]+$/g, "");
  return t.length >= 4 ? t : null;
}

async function main() {
  const force = process.argv.includes("--force");
  console.log("--- TITRES SYNTHÉTISÉS DES DOSSIERS ---");

  // Périmètre visible : textes en cours AN/Sénat + (les promulgués sont dans current_chamber JORF).
  const rows = await fetchAll(q => q.in("current_chamber", ["AN", "SENAT", "JORF", "CC"]));
  const long = rows.filter(r => (r.title || "").length > MIN_LEN);
  console.log(`> ${rows.length} dossiers visibles, ${long.length} à titre long.`);

  const { data: existing } = await supabase.from("dossier_display_title").select("dossier_id, input_hash");
  const byId = new Map((existing || []).map((r: any) => [r.dossier_id, r.input_hash]));

  let ok = 0, skip = 0;
  for (const d of long) {
    const h = hash(d.title);
    if (!force && byId.get(d.id) === h) { skip++; continue; }
    try {
      const short = await shorten(d.title);
      if (!short) { skip++; continue; }
      await supabase.from("dossier_display_title").upsert({ dossier_id: d.id, display_title: short, input_hash: h, generated_at: new Date().toISOString() }, { onConflict: "dossier_id" });
      ok++;
      if (ok % 50 === 0) console.log(`  … ${ok} générés`);
      await sleep(120);
    } catch (e: any) { console.warn(`  ! ${d.id}: ${e.message}`); }
  }
  console.log(`--- TERMINE. ${ok} titres synthétisés, ${skip} inchangés/ignorés. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
