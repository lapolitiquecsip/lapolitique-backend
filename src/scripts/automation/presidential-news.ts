import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { agentikActif } from "../../lib/agentik.js";
import { chercherPresse, mediaReconnu, verifierArticle } from "../../lib/verification-article.js";

/**
 * Fil d'actualité de chaque candidat (réécrit le 30/10/2026). Rien n'est publié sans contrôle :
 * voir lib/verification-article.ts. La recherche passe par Serper (Agentik), qui donne l'adresse
 * réelle de l'article ; celle de Google Actualités est une redirection illisible.
 *
 * Les articles refusés sont gardés, masqués, avec leur motif (`rejet_motif`) : on ne les relit pas
 * et on peut contrôler les refus. Sans clé Agentik ou sans modèle, rien n'est publié.
 *   --rattrapage  reconstruit le fil sur 30 jours (plus d'articles par candidat)
 *   --seul=slug   un seul candidat
 */
const RATTRAPAGE = process.argv.includes("--rattrapage");
const SEUL = process.argv.find(a => a.startsWith("--seul="))?.split("=")[1];
const MAX_PUBLIES = RATTRAPAGE ? 12 : 5;
const MAX_LUS = RATTRAPAGE ? 20 : 8;

function titreSansMedia(titre: string): string {
  const i = titre.lastIndexOf(" - ");
  return i > 20 ? titre.slice(0, i).trim() : titre.trim();
}

export async function syncPresidentialNews() {
  if (!agentikActif()) { console.log("[Presidential-News] Pas de clé Agentik : aucune publication sans contrôle."); return 0; }
  let q = supabase.from("presidential_candidates").select("id, slug, full_name").eq("status", "declared");
  if (SEUL) q = q.eq("slug", SEUL);
  const { data: candidates, error } = await q;
  if (error) throw error;

  let publies = 0, refuses = 0;
  const motifs = new Map<string, number>();
  for (const candidate of candidates ?? []) {
    // 10 résultats au plus par recherche, classés par pertinence et non par date : on vise le mois.
    const mois = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    const nom = `"${candidate.full_name}"`;
    const requetes = RATTRAPAGE ? [`${nom} ${mois}`, `${nom} présidentielle ${mois}`, `${nom} interview ${mois}`, nom] : [`${nom} ${mois}`];
    const trouves = new Map<string, any>();
    for (const q of requetes) {
      const r = await chercherPresse(q);
      // Médias non reconnus écartés dès ici : ni lecture ni dépense.
      for (const n of r ?? []) if (n.link && n.title && mediaReconnu(n.link)) trouves.set(n.link, n);
    }
    const items = [...trouves.values()];
    const urls = items.map((n: any) => n.link);
    const { data: connus } = urls.length
      ? await supabase.from("candidate_news").select("source_url").eq("candidate_id", candidate.id).in("source_url", urls)
      : { data: [] as any[] };
    const deja = new Set((connus ?? []).map((x: any) => x.source_url));

    let nbPublies = 0, nbLus = 0;
    for (const item of items) {
      if (deja.has(item.link)) continue;
      if (nbPublies >= MAX_PUBLIES || nbLus >= MAX_LUS) break;
      nbLus++;
      const titre = titreSansMedia(item.title);
      try {
        const v = await verifierArticle(candidate.full_name, titre, item.link);
        if (v.ok === true) {
          const { error: e } = await supabase.from("candidate_news").insert({
            candidate_id: candidate.id, date: v.date.slice(0, 10), title: v.titre, summary: v.resume, news_type: v.type,
            source_name: v.media, source_url: item.link, citation: v.citation, verifie_le: new Date().toISOString(),
          });
          if (e) { console.error(`[Presidential-News] insert : ${e.message}`); continue; }
          nbPublies++; publies++;
        } else {
          // Panne passagère (lecture ou modèle) : pas de trace, on réessaiera au prochain passage.
          if (/illisible|sans réponse/.test(v.motif)) { motifs.set(v.motif, (motifs.get(v.motif) || 0) + 1); continue; }
          await supabase.from("candidate_news").insert({
            candidate_id: candidate.id, date: (v.date || new Date().toISOString()).slice(0, 10), title: titre, summary: null, news_type: "actualite",
            source_name: v.media || "Inconnu", source_url: item.link, rejet_motif: v.motif,
          });
          refuses++;
          const famille = v.motif.replace(/\s*\(.*$/, "");
          motifs.set(famille, (motifs.get(famille) || 0) + 1);
        }
      } catch (cause: any) {
        console.error(`[Presidential-News] ${candidate.full_name} : ${cause.message}`);
      }
    }
    console.log(`[Presidential-News] ${candidate.full_name} : ${nbPublies} publié(s) sur ${nbLus} lu(s).`);
  }
  console.log(`[Presidential-News] Terminé : ${publies} publié(s), ${refuses} refusé(s).`);
  for (const [m, n] of [...motifs].sort((a, b) => b[1] - a[1])) console.log(`  · ${n} : ${m}`);
  return publies;
}

if (process.argv[1] && process.argv[1].endsWith("presidential-news.ts")) {
  syncPresidentialNews().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
