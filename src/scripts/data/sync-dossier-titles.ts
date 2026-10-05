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

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Titre coupé net par la limite de longueur : le dernier mot n'est qu'un début de mot
 * du titre officiel (« …par la transparence des rémun »). Avec un modèle qui raisonne
 * avant de répondre, 400 jetons ne suffisaient pas toujours.
 */
// Mots complets relevés dans tous les intitulés officiels (rempli au début du passage) :
// « sport » ou « Algérie » y figurent, « rémun » ou « immobili » jamais.
const VOCAB = new Set<string>();

export function tronque(court: string, officiel: string): boolean {
  if (/�/.test(court)) return true;
  const dernier = norm(court).match(/([a-z0-9]+)$/)?.[1];
  if (!dernier || VOCAB.has(dernier)) return false;
  const mots: string[] = norm(officiel).match(/[a-z0-9]+/g) ?? [];
  if (/^\d+$/.test(dernier)) return mots.some(m => /^\d+$/.test(m) && m.length > dernier.length && m.startsWith(dernier));   // « 202 » pour 2026
  // Participes et adjectifs (« rejeté », « renforcée ») : mots complets.
  if (dernier.length > 2 && /e$/.test(dernier)) return false;
  // Coupé = début d'un mot du titre officiel auquel il manque au moins deux lettres
  // (une lettre de moins, c'est un pluriel ou un infinitif : « salon », « assoupli »).
  return mots.some(m => m.length >= dernier.length + 2 && m.startsWith(dernier));
}

async function shorten(title: string): Promise<string | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-chat",
    max_tokens: 2000,
    sansReflexion: true,
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
  if (t.length < 4 || tronque(t, title)) return null;   // mieux vaut le titre officiel qu'un titre coupé
  return t;
}

async function main() {
  const force = process.argv.includes("--force");
  console.log("--- TITRES SYNTHÉTISÉS DES DOSSIERS ---");

  // Périmètre visible : textes en cours AN/Sénat + (les promulgués sont dans current_chamber JORF).
  const rows = await fetchAll(q => q.in("current_chamber", ["AN", "SENAT", "JORF", "CC"]));
  const long = rows.filter(r => (r.title || "").length > MIN_LEN);
  console.log(`> ${rows.length} dossiers visibles, ${long.length} à titre long.`);

  const existing: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("dossier_display_title").select("dossier_id, input_hash, display_title").range(from, from + 999);
    existing.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const titres = new Map(rows.map(r => [r.id, r.title]));
  for (const r of rows) for (const m of norm(r.title || "").match(/[a-z0-9]+/g) || []) VOCAB.add(m);
  // Titres déjà coupés en base : retirés, puis régénérés dans ce passage (à défaut, l'intitulé
  // officiel s'affiche, entier).
  const coupes = existing.filter(r => titres.has(r.dossier_id) && tronque(r.display_title || "", titres.get(r.dossier_id)));
  if (coupes.length) {
    await supabase.from("dossier_display_title").delete().in("dossier_id", coupes.map(r => r.dossier_id));
    console.log(`> ${coupes.length} titre(s) court(s) coupé(s) retiré(s), à régénérer.`);
  }
  const byId = new Map(existing.filter(r => !coupes.includes(r)).map((r: any) => [r.dossier_id, r.input_hash]));

  let ok = 0, skip = 0, quotaVide = 0;
  for (const d of long) {
    const h = hash(d.title);
    if (!force && byId.get(d.id) === h) { skip++; continue; }
    try {
      const short = await shorten(d.title);
      if (!short) { skip++; continue; }
      await supabase.from("dossier_display_title").upsert({ dossier_id: d.id, display_title: short, input_hash: h, generated_at: new Date().toISOString() }, { onConflict: "dossier_id" });
      ok++; quotaVide = 0;
      if (ok % 50 === 0) console.log(`  … ${ok} générés`);
      await sleep(120);
    } catch (e: any) {
      console.warn(`  ! ${d.id}: ${e.message}`);
      // Quota gratuit du jour épuisé : inutile de parcourir les milliers de titres restants
      // (le passage dépassait sa durée et finissait annulé).
      if (/Aucun modèle gratuit disponible/.test(String(e?.message)) && ++quotaVide >= 3) {
        console.log("::warning::Quota IA gratuit épuisé : titres restants au prochain passage.");
        break;
      }
    }
  }
  console.log(`--- TERMINE. ${ok} titres synthétisés, ${skip} inchangés/ignorés. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
