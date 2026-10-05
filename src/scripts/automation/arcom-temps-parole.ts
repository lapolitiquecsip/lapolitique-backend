import "dotenv/config";
import { supabase } from "../../config/supabase.js";

/**
 * Temps de parole des candidats à la télévision et à la radio, d'après l'Arcom.
 *
 * L'Arcom publie chaque mois, avec environ deux mois de décalage, le temps de
 * parole de chaque personnalité politique, antenne par antenne (journaux,
 * magazines, autres programmes). La page « hors élections » de l'année porte la
 * liste des fichiers dans ses réglages (drupalSettings.tphpe) : on la lit pour
 * l'année en cours et la précédente, et on recharge chaque mois (les chiffres d'un
 * mois peuvent être corrigés).
 */

const BASE = "https://www.arcom.fr";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; lapolitiquecestsimple-veille)" };
const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** « LE PEN Marine » → « marine le pen » : nom en capitales, prénom ensuite. */
function cleArcom(nom: string): string {
  const mots = nom.trim().split(/\s+/);
  const famille = mots.filter(m => m === m.toUpperCase() && /[A-ZÀ-Ý]/.test(m));
  const prenom = mots.filter(m => !famille.includes(m));
  return norm(`${prenom.join(" ")} ${famille.join(" ")}`);
}

const secondes = (hms: string) => {
  const m = (hms || "").match(/^(\d+):(\d{2}):(\d{2})$/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
};

/** Ligne CSV « ; » avec guillemets. */
function cellules(ligne: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (const ch of ligne) {
    if (ch === '"') q = !q;
    else if (ch === ";" && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

async function fichiers(annee: number) {
  const r = await fetch(`${BASE}/temps-parole/hors-elections/recherche/source/${annee}`, { headers: UA });
  if (!r.ok) return [];
  const h = await r.text();
  const m = h.match(/data-drupal-selector="drupal-settings-json">([\s\S]*?)<\/script>/);
  if (!m) return [];
  const reglages = JSON.parse(m[1]);
  const out: { mois: string; url: string }[] = [];
  for (const mo of reglages.tphpe?.[0]?.mois || []) for (const f of mo.fichiers || []) {
    if (!/personnalit/.test(f.type || "") || !f.file_uri) continue;
    const [, mm, aaaa] = (f.date_start || "").split("/");
    if (!mm || !aaaa) continue;
    out.push({ mois: `${aaaa}-${mm}-01`, url: BASE + f.file_uri });
  }
  return out;
}

async function main() {
  const { data: cands, error } = await supabase.from("presidential_candidates").select("slug, full_name").in("status", ["declared", "pressenti"]);
  if (error) throw error;
  const parCle = new Map((cands || []).map(c => [norm(c.full_name), c.slug]));

  const an = new Date().getUTCFullYear();
  const liste = [...(await fichiers(an)), ...(await fichiers(an - 1))];
  if (!liste.length) throw new Error("Aucun fichier Arcom trouvé : la page a peut-être changé de structure.");

  const rows: any[] = [];
  for (const f of liste) {
    const r = await fetch(f.url, { headers: UA });
    if (!r.ok) { console.warn(`[Arcom] ${f.mois} illisible (${r.status})`); continue; }
    const lignes = (await r.text()).split(/\r?\n/).filter(Boolean);
    const chaines = cellules(lignes[0]);
    for (const l of lignes.slice(3)) {
      const c = cellules(l);
      const slug = parCle.get(cleArcom(c[0] || ""));
      if (!slug) continue;
      const detail: Record<string, number> = {}; let total = 0;
      for (let i = 2; i < c.length; i++) {
        const s = secondes(c[i]); if (!s) continue;
        const ch = (chaines[i] || "?").replace(/:$/, "");
        detail[ch] = (detail[ch] || 0) + s; total += s;
      }
      rows.push({ slug, mois: f.mois, secondes: total, detail, source: f.url, maj_le: new Date().toISOString() });
    }
  }
  // Un candidat absent d'un fichier n'a pas parlé ce mois-là (ou sous le seuil de publication).
  const uniques = [...new Map(rows.map(r => [`${r.slug}|${r.mois}`, r])).values()];
  const { error: e } = await supabase.from("arcom_temps_parole").upsert(uniques, { onConflict: "slug,mois" });
  if (e) throw e;
  const mois = [...new Set(uniques.map(r => r.mois))].sort();
  console.log(`[Arcom] ${liste.length} fichier(s) mensuel(s), ${uniques.length} relevé(s) candidat × mois (${mois[0]} → ${mois[mois.length - 1]}).`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
