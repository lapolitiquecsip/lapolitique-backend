import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { FAMILLES, lireSource, controler, type Famille } from "../../lib/banc.js";

/**
 * BANC D'ESSAI — agent « vérificateur » (sans IA).
 *
 * Pour chaque fonctionnalité du banc, il prend les derniers textes publiés, relit leur
 * source et note ce que le texte affirme sans que la source le porte (nombres, noms propres).
 * Il ne corrige rien et ne dépublie rien : il consigne, dans le journal, ce qu'un agent
 * vérificateur placé dans la chaîne aurait arrêté.
 *
 *   conforme     rien à signaler
 *   a_revoir     au moins un nombre absent de la source, ou trois noms propres
 *   sans_source  la source n'a pas pu être relue (le motif est noté)
 *
 * Usage : npx tsx src/scripts/agents/banc-verificateur.ts [--max=12] [--famille=commissions] [--dry-run]
 */
const AGENT = "banc-verificateur";
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split("=")[1];
const MAX = Number(arg("max") || 12);
const SEULE = arg("famille");
const DRY = process.argv.includes("--dry-run");

async function passer(f: Famille) {
  let q = supabase.from(f.table).select(f.colonnes).not(f.date, "is", null).order(f.date, { ascending: false }).limit(60);
  if (f.filtre) q = f.filtre(q);
  const { data, error } = await q;
  if (error) { console.warn(`  ! ${f.cle} : ${error.message}`); return; }

  const cycle = `banc:${f.cle}`;
  const { data: deja } = await supabase.from("cycle_items").select("cle").eq("cycle", cycle).limit(5000);
  const vus = new Set((deja ?? []).map((d: any) => d.cle));
  const nouveaux = (data ?? [] as any[]).filter((r: any) => !vus.has(String(r[f.id]))).slice(0, MAX);

  const bilan = { conforme: 0, a_revoir: 0, sans_source: 0 };
  const motifs: Record<string, number> = {};
  for (const r of nouveaux as any[]) {
    const texte = f.texte(r);
    if (texte.trim().length < 40) continue;
    const src = f.source(r);
    const lue = await lireSource(src);
    let etape: keyof typeof bilan, donnees: Record<string, any>, erreur: string | null = null;
    if ("motif" in lue) { etape = "sans_source"; erreur = lue.motif; donnees = {}; motifs[lue.motif] = (motifs[lue.motif] || 0) + 1; }
    else {
      const c = controler(texte, lue.texte);
      etape = c.chiffres.length >= 1 || c.noms.length >= 3 ? "a_revoir" : "conforme";
      donnees = { chiffres_absents: c.chiffres, noms_absents: c.noms, longueur_texte: texte.length, longueur_source: lue.texte.length };
      if (etape === "a_revoir") console.log(`    ✗ ${f.titre(r)?.slice(0, 70)} — chiffres : ${c.chiffres.join(" · ") || "—"} ; noms : ${c.noms.join(" · ") || "—"}`);
    }
    bilan[etape]++;
    if (DRY) continue;
    const { error: e } = await supabase.from("cycle_items").upsert({
      cycle, cle: String(r[f.id]), etape, erreur, agent: AGENT,
      sujet: f.sujet?.(r)?.slice(0, 120) ?? null, titre: String(f.titre(r) ?? "").slice(0, 300),
      source_url: src.url ?? null, date_objet: String(r[f.date] ?? "").slice(0, 10) || null,
      donnees, maj_le: new Date().toISOString(),
    }, { onConflict: "cycle,cle" });
    if (e) console.warn(`    ! ${e.message}`);
    await new Promise(x => setTimeout(x, 250));
  }
  console.log(`  ${f.nom} : ${nouveaux.length} texte(s) — ${bilan.conforme} conforme(s), ${bilan.a_revoir} à revoir, ${bilan.sans_source} sans source lisible`);
  for (const [m, n] of Object.entries(motifs)) console.log(`      ${n} × ${m}`);
}

async function main() {
  console.log(`=== Banc d'essai · vérificateur${DRY ? " (essai, rien n'est écrit)" : ""} ===`);
  for (const f of FAMILLES) if (!SEULE || SEULE === f.cle) await passer(f);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
