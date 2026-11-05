import "dotenv/config";
import { supabase } from "../../config/supabase.js";

/**
 * Relie le dossier de l'Assemblée et celui du Sénat d'un MÊME texte (companion_dossier_id, dans
 * les deux sens). Chaque chambre publie son propre dossier : sans lien, un texte transmis d'une
 * chambre à l'autre apparaissait deux fois sur le site, et la fiche de la première chambre
 * gardait sa dernière étape (« Renvoi en commission ») alors que le texte était chez l'autre.
 *
 * Les deux chambres n'intitulent pas le texte pareil (« Renforcer la pénalisation de… » à
 * l'Assemblée, « Proposition de loi visant à renforcer la pénalisation de… » au Sénat) : on
 * prend d'abord le lien certain (le dossier de l'Assemblée cite l'adresse du dossier du Sénat),
 * sinon on compare le titre sans sa formule d'entrée, ET la date du premier dépôt (à 20 jours près). Une
 * paire n'est retenue que si elle est unique des deux côtés : dans le doute, aucun lien.
 *
 *   --dry   affiche les paires sans rien écrire
 */
const DRY = process.argv.includes("--dry");
const JOURS = 20;

const plat = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’'`]/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
/** Le titre sans « Proposition de loi (organique) visant à / relative à / portant… ». */
export function coeur(titre: string): string {
  return plat(titre)
    .replace(/^(proposition|projet) de loi( organique| constitutionnelle)?( de programmation)?\s*/, "")
    .replace(/^(visant a|tendant a|relative? (a|au|aux)|portant|pour|en faveur d[eu]s?|sur)\s+/, "")
    .replace(/\s+(premiere|deuxieme|nouvelle) lecture.*$/, "")
    .trim();
}

async function tous() {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("legislative_dossiers").select("id, official_id, title, deposited_at, companion_dossier_id, legislature, source_urls")
      .eq("legislature", 17).range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  const dossiers = await tous();
  const senat = dossiers.filter(d => String(d.official_id).startsWith("SENAT:"));
  const an = dossiers.filter(d => !String(d.official_id).startsWith("SENAT:"));
  const parCoeur = new Map<string, any[]>();
  for (const d of an) { const k = coeur(d.title); if (k.length >= 15) parCoeur.set(k, [...(parCoeur.get(k) || []), d]); }
  const proche = (a: string | null, b: string | null) => !!a && !!b && Math.abs(Date.parse(a) - Date.parse(b)) <= JOURS * 864e5;

  const paires: [any, any][] = [];
  const pris = new Map<string, number>();
  // Lien certain : l'adresse senat.fr/dossier-legislatif/<x>.html dans le dossier de l'Assemblée.
  const parUrl = new Map<string, any[]>();
  for (const a of an) for (const u of a.source_urls || []) {
    const m = String(u).match(/senat\.fr\/dossier-legislatif\/([a-z0-9-]+)\.html/i);
    if (m) parUrl.set(`SENAT:${m[1].toLowerCase()}`, [...(parUrl.get(`SENAT:${m[1].toLowerCase()}`) || []), a]);
  }
  for (const s of senat) {
    const certains = parUrl.get(String(s.official_id).toLowerCase().replace(/^senat:/, "SENAT:")) || [];
    const c = certains.length ? certains : (parCoeur.get(coeur(s.title)) || []).filter(a => proche(a.deposited_at, s.deposited_at));
    if (c.length !== 1) continue;
    paires.push([c[0], s]);
    pris.set(c[0].id, (pris.get(c[0].id) || 0) + 1);
  }
  // Un dossier de l'Assemblée revendiqué par deux dossiers du Sénat : ambigu, aucun lien.
  const sures = paires.filter(([a]) => pris.get(a.id) === 1);
  const nouvelles = sures.filter(([a, s]) => a.companion_dossier_id !== s.id || s.companion_dossier_id !== a.id);
  console.log(`[Navette] ${sures.length} paire(s) Assemblée ↔ Sénat, dont ${nouvelles.length} à relier (${paires.length - sures.length} ambiguë(s) écartée(s)).`);
  if (DRY) { for (const [a, s] of nouvelles.slice(0, 40)) console.log(`  ${a.official_id} « ${a.title.slice(0, 60)} » ↔ ${s.official_id} (${a.deposited_at} / ${s.deposited_at})`); return; }
  for (const [a, s] of nouvelles) {
    const e1 = await supabase.from("legislative_dossiers").update({ companion_dossier_id: s.id }).eq("id", a.id);
    const e2 = await supabase.from("legislative_dossiers").update({ companion_dossier_id: a.id }).eq("id", s.id);
    if (e1.error || e2.error) console.warn(`  ! ${a.official_id} ↔ ${s.official_id} : ${(e1.error || e2.error)!.message}`);
  }
  console.log(`[Navette] ${nouvelles.length} lien(s) écrit(s).`);
}

if (process.argv[1]?.endsWith("lier-dossiers-navette.ts")) main().catch(e => { console.error(e); process.exitCode = 1; });
