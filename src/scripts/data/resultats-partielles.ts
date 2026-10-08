import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { chargerAMO10, mandatDepute, parElectionPartielle } from "../../lib/fiche-an.js";

// Résultat électoral des députés élus lors d'une législative partielle.
// La fiche affichait le résultat de 2024 de la circonscription, donc l'élection de leur
// prédécesseur (Nathalie Coggia montrait celle de Stéphane Vojetta), ou rien du tout.
// Source : l'article Wikipédia qui recense les partielles de la XVIIe législature, dont les
// tableaux citent les procès-verbaux des commissions de recensement des préfectures.
// Même format que les autres fiches ({ round, candidates }), avec election = "partielle".
//   npx tsx src/scripts/data/resultats-partielles.ts [--dry]

const PAGE = "Élections législatives partielles au cours de la XVIIe législature de la Cinquième République française";
const DRY = process.argv.includes("--dry");
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[-']/g, " ").replace(/\s+/g, " ").trim();

/** Enlève références, modèles et liens d'une cellule de wikitexte. */
function nettoyer(c: string): string {
  return c
    .replace(/<ref[^>]*\/>/g, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    .replace(/\{\{formatnum:([\d\s]+)\}\}/g, "$1")
    .replace(/\{\{(?:Abrd|abrd|Abréviation discrète)\|([^|}]+)\|[^}]*\}\}/g, "$1")
    .replace(/\{\{,\}\}/g, "").replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, "$1")
    .replace(/'''?/g, "").replace(/<[^>]+>/g, "").replace(/^\s*align="?\w+"?\s*\|/, "")
    .trim();
}

type Cand = { name: string; party: string; t1: number; p1: string; t2: number | null; p2: string | null };

/** Lit le premier tableau de résultats d'une section. */
function lireTableau(section: string): Cand[] {
  const debut = section.indexOf("{|"), fin = section.indexOf("|}", debut);
  if (debut < 0 || fin < 0) return [];
  const lignes = section.slice(debut, fin).split(/\n\|-/).slice(1);
  const out: Cand[] = [];
  for (const l of lignes) {
    if (!/Infobox Parti politique français\/couleurs/.test(l)) continue;
    // Une cellule par ligne (« | … » ou « || » sur la même ligne).
    const cellules = l.split("\n").filter(x => /^\s*[|!]/.test(x)).flatMap(x => x.replace(/^\s*[|!]\s?/, "").split(/\s*\|\|\s*/)).map(nettoyer);
    const utiles = cellules.filter(c => c !== "" && c !== "|");
    // Ordre attendu : nom, parti, voix T1, % T1, évolution, [voix T2, % T2, évolution].
    const nombres = utiles.map(c => c.replace(/\s/g, "")).map(c => (/^\d+$/.test(c) ? Number(c) : null));
    const iNom = 0, iParti = 1;
    const iT1 = nombres.findIndex((n, i) => i > iParti && n !== null);
    if (iT1 < 0) continue;
    const iT2 = nombres.findIndex((n, i) => i > iT1 + 1 && n !== null);
    out.push({
      name: utiles[iNom], party: utiles[iParti],
      t1: nombres[iT1]!, p1: utiles[iT1 + 1],
      t2: iT2 > 0 ? nombres[iT2] : null, p2: iT2 > 0 ? utiles[iT2 + 1] : null,
    });
  }
  return out;
}

async function main() {
  const r = await fetch(`https://fr.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&page=${encodeURIComponent(PAGE)}`,
    { headers: { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" } });
  const texte: string = (await r.json() as any)?.parse?.wikitext?.["*"] ?? "";
  if (!texte) throw new Error("page Wikipédia des partielles introuvable");
  const sections = texte.split(/\n(?====[^=])/).filter(s => s.startsWith("==="));

  const an = await chargerAMO10();
  const elus = [...an.acteurs.entries()].filter(([, a]) => parElectionPartielle(a));
  console.log(`> ${elus.length} député(s) en fonction élu(s) lors d'une partielle.`);

  for (const [uid, a] of elus) {
    const m = mandatDepute(a), lieu = m?.election?.lieu ?? {};
    const circo = Number(lieu.numCirco), dep = norm(String(lieu.departement || ""));
    const nom = `${a.etatCivil?.ident?.prenom} ${a.etatCivil?.ident?.nom}`;
    // Titre : « {{2e|circonscription}} de Paris », « {{1re|circonscription de l'Isère}} »…
    const sec = sections.find(s => {
      const titre = s.split("\n")[0];
      const n = Number(titre.match(/\{\{(\d+)/)?.[1]);
      return n === circo && norm(titre).includes(dep);
    });
    if (!sec) { console.log(`  · ${nom} : section introuvable (${lieu.departement} ${circo}e)`); continue; }
    const cands = lireTableau(sec);
    const gagnant = cands.find(c => norm(c.name).includes(norm(String(a.etatCivil?.ident?.nom || ""))));
    if (!cands.length || !gagnant) { console.log(`  · ${nom} : tableau illisible ou élu absent du tableau`); continue; }
    const deuxTours = cands.some(c => c.t2 !== null);
    const round = deuxTours ? 2 : 1;
    const liste = cands
      .filter(c => (deuxTours ? c.t2 !== null : true))
      .map(c => ({ name: c.name, party: c.party, votes: deuxTours ? c.t2! : c.t1, percent: `${deuxTours ? c.p2 : c.p1}%` }))
      .sort((x, y) => y.votes - x.votes).slice(0, 5);
    if (norm(liste[0].name) !== norm(gagnant.name)) { console.log(`  · ${nom} : l'élu n'arrive pas en tête du tableau lu, rien écrit`); continue; }
    const score = { round, candidates: liste, election: "partielle", date: String(m?.mandature?.datePriseFonction || "") };
    console.log(`  ${nom} : ${round}e tour — ${liste.map(c => `${c.name} ${c.percent}`).join(", ")}`);
    if (!DRY) {
      const { error } = await supabase.from("deputies").update({ election_score: score }).eq("an_id", uid);
      if (error) console.warn(`  ! ${error.message}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
