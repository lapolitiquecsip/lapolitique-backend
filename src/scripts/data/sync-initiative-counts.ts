import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Compte les initiatives législatives par élu (députés & sénateurs) à partir des dossiers
// OFFICIELS (legislative_dossiers.author_name). Réplique EXACTEMENT le parseur du front
// (parseInitiators/normalizeName) pour que les comptes correspondent aux fiches.
//   - auteur principal = 1er initiateur listé (celui qui dépose le texte).
//   - co-signés = tout initiateur figurant dans la liste.

function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function parseInitiators(raw?: string | null): string[] {
  if (!raw) return [];
  let s = raw.trim();
  if (/^le gouvernement$/i.test(s)) return [];
  s = s.replace(/,?\s*(s[ée]nateur|s[ée]natrice|d[ée]put[ée])s?(\s+et\s+(s[ée]nateur|s[ée]natrice)s?)?\.?\s*$/i, "").trim();
  s = s.replace(/^par\s+/i, "").trim();
  if (!s) return [];
  return s.split(/,|\s+et\s+/i).map(p => p.replace(/^\s*(MM\.|Mmes|Mme|M\.)\s*/i, "").trim()).filter(Boolean);
}

async function fetchAll(table: string, select: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  console.log("--- COMPTAGE DES INITIATIVES LÉGISLATIVES ---");

  // Index nom normalisé → { table, id }. Un même nom peut être député OU sénateur.
  const deputies = await fetchAll("deputies", "id, first_name, last_name");
  const senators = await fetchAll("senators", "id, first_name, last_name");
  const index = new Map<string, { table: string; id: string }>();
  for (const d of deputies) { const k = normalizeName(`${d.first_name} ${d.last_name}`); if (k) index.set(k, { table: "deputies", id: d.id }); }
  for (const s of senators) { const k = normalizeName(`${s.first_name} ${s.last_name}`); if (k && !index.has(k)) index.set(k, { table: "senators", id: s.id }); }
  console.log(`> ${deputies.length} députés + ${senators.length} sénateurs indexés.`);

  const primary = new Map<string, number>();   // clé "table:id" → nb auteur principal
  const total = new Map<string, number>();      // clé "table:id" → nb co-signés

  const dossiers = await fetchAll("legislative_dossiers", "author_name");
  console.log(`> ${dossiers.length} dossiers à dépouiller.`);
  for (const d of dossiers) {
    const names = parseInitiators(d.author_name);
    if (names.length === 0) continue;
    let first = true;
    const seen = new Set<string>();
    for (const n of names) {
      const hit = index.get(normalizeName(n));
      if (hit) {
        const key = `${hit.table}:${hit.id}`;
        if (first && !seen.has("__p__")) { primary.set(key, (primary.get(key) || 0) + 1); }
        if (!seen.has(key)) { total.set(key, (total.get(key) || 0) + 1); seen.add(key); }
      }
      first = false;
    }
  }

  // Écriture : toutes les lignes remises à 0 puis mises à jour (pour purger d'anciens comptes).
  let updated = 0;
  for (const [table, rows] of [["deputies", deputies], ["senators", senators]] as const) {
    for (const r of rows) {
      const key = `${table}:${r.id}`;
      const p = primary.get(key) || 0, t = total.get(key) || 0;
      await supabase.from(table).update({ initiative_primary_count: p, initiative_count: t }).eq("id", r.id);
      updated++;
    }
  }
  const topD = [...primary.entries()].filter(e => e[0].startsWith("deputies")).sort((a, b) => b[1] - a[1])[0];
  console.log(`--- TERMINE. ${updated} élus mis à jour. Top député (auteur principal) : ${topD?.[1] ?? 0} textes. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
