import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { agentikActif } from "../../lib/agentik.js";
import { chercherPresse, citationDansTexte, jsonDuModele, lireArticle, mediaReconnu, norm } from "../../lib/verification-article.js";

/**
 * Preuve de candidature de chaque personne suivie (30/10/2026) : ce qu'elle a dit elle-même, où et
 * quand, relevé dans des articles de médias reconnus lus en entier, avec une citation retrouvée mot
 * pour mot. Écrit dans presidential_candidates.candidature_preuve, affiché sur la fiche.
 *
 * Ne change JAMAIS le statut d'un candidat : un désaccord est signalé dans le journal, pour décision.
 * Une fois par semaine (le lundi) ; `--force` pour lancer quand même, `--seul=slug` pour une personne.
 */
const FORCE = process.argv.includes("--force");
const SEUL = process.argv.find(a => a.startsWith("--seul="))?.split("=")[1];
const STATUTS = ["declare", "pressenti", "non_candidat"];

async function preuve(nom: string) {
  const liens: { url: string; media: string }[] = [];
  for (const q of [`"${nom}" candidature présidentielle 2027`, `"${nom}" candidat présidentielle annonce`]) {
    const r = await chercherPresse(q);
    for (const n of r ?? []) {
      const media = mediaReconnu(n.link);
      if (media && !liens.some(l => l.media === media)) liens.push({ url: n.link, media });
    }
  }
  if (!liens.length) return null;
  const fam = norm(nom.split(" ").pop() || nom);
  const articles: { url: string; media: string; date: string | null; extrait: string; texte: string }[] = [];
  for (const l of liens.slice(0, 6)) {
    if (articles.length >= 4) break;
    const a = await lireArticle(l.url);
    // Moins d'un an : une déclaration plus ancienne ne dit plus rien de 2027.
    if (!a || !a.date || Date.now() - Date.parse(a.date) > 365 * 864e5) continue;
    if (!norm(a.texte).includes(fam)) continue;
    // Autour du nom : un article « tous les candidats » ne parle de la personne qu'en un endroit.
    const bas = a.texte.toLowerCase();
    const passages: string[] = [];
    for (let i = 0, n = 0; n < 3; n++) {
      const p = bas.indexOf((nom.split(" ").pop() || nom).toLowerCase(), i);
      if (p < 0) break;
      passages.push(a.texte.slice(Math.max(0, p - 500), p + 800));
      i = p + 800;
    }
    articles.push({ url: l.url, media: l.media, date: a.date, extrait: passages.join("\n…\n"), texte: a.texte });
  }
  if (!articles.length) return { statut: "non_etablie", verifie_le: new Date().toISOString() };

  const j = await jsonDuModele(`Tu établis où en est ${nom} vis-à-vis de la présidentielle 2027, en n'utilisant QUE les extraits fournis, jamais tes connaissances. Nous sommes le ${new Date().toISOString().slice(0, 10)}.

Réponds en JSON strict : { "statut": "declare|pressenti|non_candidat|non_etablie", "phrase": "...", "citation": "...", "article": 0, "articles_concordants": [0], "contradiction": "..." }

- declare : ${nom} a dit LUI-MÊME ou ELLE-MÊME être candidat·e, ou un article l'affirme nettement comme une annonce faite.
- pressenti : on le lui prête, ou c'est présenté comme une intention, une hésitation, une candidature pas encore annoncée.
- non_candidat : a dit EXPLICITEMENT ne pas l'être ou s'être retiré·e. Soutenir ou aider quelqu'un d'autre sans le dire n'est pas un retrait : c'est "pressenti", avec le fait dans la phrase et l'écart dans "contradiction".
- non_etablie : les extraits ne permettent pas de trancher.
- Si les articles divergent, retiens le plus récent et décris l'écart dans "contradiction" (sinon chaîne vide).
- phrase : une phrase neutre (25 mots au plus) qui dit la situation, avec la date si elle est donnée. N'écris jamais « officiellement » : personne n'est officiellement candidat avant la liste du Conseil constitutionnel.
- citation : une phrase COPIÉE MOT POUR MOT de l'extrait choisi, 10 à 30 mots.
- article : le numéro de l'extrait d'où vient la citation.
- articles_concordants : les numéros de TOUS les extraits qui disent la même chose que le statut retenu.`,
    articles.map((a, i) => `[${i}] ${a.media}, ${a.date?.slice(0, 10)}\n${a.extrait}`).join("\n\n"));
  const a = articles[Number(j?.article)];
  if (!j || !STATUTS.includes(j.statut) || !a || !j.citation || !citationDansTexte(j.citation, a.texte)) return { statut: "non_etablie", verifie_le: new Date().toISOString() };
  // Dire qu'une personne n'est plus candidate engage : deux médias distincts au moins.
  const accord = new Set((Array.isArray(j.articles_concordants) ? j.articles_concordants : []).map((i: unknown) => articles[Number(i)]?.media).filter(Boolean));
  if (j.statut === "non_candidat" && accord.size < 2) j.statut = "pressenti";
  return { statut: j.statut, phrase: j.phrase || null, citation: j.citation, source: a.media, url: a.url, date: a.date?.slice(0, 10), contradiction: j.contradiction || null, verifie_le: new Date().toISOString() };
}

async function main() {
  if (!FORCE && !SEUL && new Date().getUTCDay() !== 1) { console.log("[Candidatures] Contrôle hebdomadaire : le lundi."); return; }
  if (!agentikActif()) { console.log("[Candidatures] Pas de clé Agentik : rien à faire."); return; }
  let q = supabase.from("presidential_candidates").select("id, slug, full_name, status").eq("status", "declared");
  if (SEUL) q = q.eq("slug", SEUL);
  const { data, error } = await q;
  if (error) throw error;
  for (const c of data ?? []) {
    const p = await preuve(c.full_name).catch(e => { console.log(`  ! ${c.full_name} : ${e.message}`); return null; });
    if (!p) continue;
    const { error: e } = await supabase.from("presidential_candidates").update({ candidature_preuve: p }).eq("id", c.id);
    if (e) console.log(`  ! ${c.full_name} : ${e.message}`);
    const alerte = p.statut !== "declare" ? "::warning::" : "";
    console.log(`${alerte}[Candidatures] ${c.full_name} : ${p.statut}${"source" in p ? ` (${p.source}, ${p.date})` : ""}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
