import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { recouper, OFFICIEL } from "../../lib/recoupement.js";

/**
 * FILS D'ACTUALITÉ — agent « recoupeur » (sans IA).
 *
 * Sa seule tâche : dire, pour chaque information de presse entrée dans un fil (communes,
 * départements, régions, partis), si un autre média la rapporte. Le résultat est écrit sur
 * la ligne elle-même (entity_feed.recoupement) et le site affiche « un seul média » quand
 * l'information n'est portée que par un journal.
 *
 * La collecte fait déjà ce contrôle au moment de publier. L'agent passe derrière pour :
 *   - les informations que la collecte n'a pas pu recouper (recherche en panne) ;
 *   - celles qui étaient « uniques » à la parution : une nouvelle locale est souvent reprise
 *     le lendemain, et la mention doit alors disparaître — on y revient pendant trois jours ;
 *   - l'historique d'avant le 12 octobre 2026, dont le titre d'origine n'a pas été conservé :
 *     faute de pouvoir chercher juste, on n'y pose jamais la mention « unique » (on ne note
 *     que les recoupements trouvés), pour ne pas étiqueter à tort.
 *
 * Usage : npx tsx src/scripts/agents/fils-recoupeur.ts [--max=120] [--jours=21] [--dry-run]
 */
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split("=")[1];
const MAX = Number(arg("max") || 120);
const JOURS = Number(arg("jours") || 21);
const DRY = process.argv.includes("--dry-run");

async function main() {
  console.log(`=== Fils d'actualité · recoupeur${DRY ? " (essai, rien n'est écrit)" : ""} ===`);
  const depuis = new Date(Date.now() - JOURS * 864e5).toISOString();
  const colonnes = "id, entity_type, source_name, source_kind, media, title, titre_origine, recoupement, recoupe_le, created_at";

  // Ce qui ne vient pas de la presse est de source officielle : rien à chercher.
  if (!DRY) {
    await supabase.from("entity_feed").update({ recoupement: "officiel", recoupe_le: new Date().toISOString() })
      .is("recoupement", null).neq("source_kind", "google_news").gte("created_at", depuis);
  }

  const { data: jamais } = await supabase.from("entity_feed").select(colonnes)
    .eq("source_kind", "google_news").is("recoupement", null).is("recoupe_le", null).gte("created_at", depuis)
    .order("created_at", { ascending: false }).limit(MAX);
  // Les « uniques » de moins de trois jours, pas revues depuis douze heures.
  const { data: uniques } = await supabase.from("entity_feed").select(colonnes)
    .eq("recoupement", "unique").gte("created_at", new Date(Date.now() - 3 * 864e5).toISOString())
    .lt("recoupe_le", new Date(Date.now() - 12 * 36e5).toISOString()).limit(Math.floor(MAX / 2));

  const bilan = { officiel: 0, recoupe: 0, unique: 0, indetermine: 0, leves: 0 };
  for (const r of [...(uniques ?? []), ...(jamais ?? [])].slice(0, MAX) as any[]) {
    let etat: string | null, medias: string[] = [];
    if (OFFICIEL.test(`${r.media ?? ""} ${r.source_name ?? ""}`)) etat = "officiel";
    else {
      try {
        const res = await recouper(r.titre_origine || r.title || "", r.media);
        medias = res?.medias ?? [];
        // Sans titre d'origine, une recherche infructueuse ne prouve rien : pas de mention.
        etat = !res ? null : res.etat === "recoupe" ? "recoupe" : r.titre_origine ? "unique" : null;
      } catch (e: any) { console.warn(`  ! ${e.message}`); await new Promise(x => setTimeout(x, 3000)); continue; }
      await new Promise(x => setTimeout(x, 650));
    }
    if (etat === "recoupe" && r.recoupement === "unique") bilan.leves++;
    bilan[(etat ?? "indetermine") as keyof typeof bilan]++;
    if (DRY) continue;
    await supabase.from("entity_feed").update({
      recoupement: etat, autres_medias: etat === "recoupe" ? medias.length : etat === "unique" ? 0 : null,
      recoupe_le: new Date().toISOString(),
    }).eq("id", r.id);
  }
  console.log(`  ${bilan.recoupe} recoupée(s) (dont ${bilan.leves} mention(s) levée(s)), ${bilan.unique} donnée(s) par un seul média, `
    + `${bilan.officiel} de source officielle, ${bilan.indetermine} sans conclusion`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
