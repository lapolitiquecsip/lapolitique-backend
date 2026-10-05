import "dotenv/config";
import Parser from "rss-parser";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

/**
 * Veille des controverses : tient à jour la rubrique « Controverses » des fiches
 * d'élus, de ministres et de candidats à partir de la presse.
 *
 * Pour chaque personnalité, une recherche Google News limitée aux derniers jours
 * et aux mots de l'affaire (enquête, plainte, révélations…). Seuls les articles
 * jamais vus partent à l'IA, en un seul appel par personne : la plupart des jours,
 * personne n'a rien de neuf et la veille ne coûte presque rien.
 *
 * L'IA décide s'il y a une affaire nouvelle et documentée, ou un développement
 * d'une affaire déjà listée (elle complète alors l'entrée existante). Garde-fou :
 * une affaire nouvelle doit être rapportée par au moins deux médias distincts.
 *
 * Les entrées sont consignées dans controverses_veille puis recopiées dans toutes
 * les fiches de la personne (étape « appliquer », rejouée à chaque passage, si
 * bien qu'une bio régénérée retrouve ses entrées).
 *
 * VEILLE_PERIMETRE=prioritaire (défaut) : candidats, gouvernement, eurodéputés,
 *   présidents de région — à chaque passage de la journée.
 * VEILLE_PERIMETRE=complet : y ajoute députés, sénateurs, présidents de
 *   département et maires des grandes villes — une fois par jour.
 * VEILLE_PERSONNE="Jordan Bardella" : une seule personne (essai).
 * VEILLE_APPLIQUER_SEUL=1 : recopie seulement les entrées consignées dans les fiches.
 */

const parser = new Parser({ timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 (compatible; lapolitiquecestsimple-veille)" } });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const JOURS = Number(process.env.VEILLE_JOURS || 4);

const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const MOTS_AFFAIRE = [
  "polémique", "controverse", "accusé", "accusée", "accusations", "enquête", "plainte", "\"mis en examen\"",
  "\"mise en examen\"", "révélations", "révèle", "condamné", "condamnée", "scandale", "soupçons", "affaire",
  "perquisition", "procès", "diffamation", "propos", "garde à vue",
];

type Fiche = { table: string; slug: string; nom: string; controverses: string[]; bio: any };
type Personne = { cle: string; nom: string; fiches: Fiche[]; prioritaire: boolean };
type Article = { titre: string; media: string; url: string; date: string; extrait: string };

// ── Qui surveiller ────────────────────────────────────────────────────────────

const TABLES: { table: string; nom: (r: any) => string; complet?: boolean; filtre?: (q: any) => any }[] = [
  { table: "presidential_candidates", nom: r => r.full_name },
  { table: "minister_profiles", nom: r => r.full_name },
  { table: "meps", nom: r => r.full_name },
  { table: "presidents", nom: r => r.full_name },
  { table: "deputies", nom: r => `${r.first_name} ${r.last_name}`, complet: true, filtre: q => q.neq("sitting", false) },
  { table: "senators", nom: r => `${r.first_name} ${r.last_name}`, complet: true, filtre: q => q.neq("sitting", false) },
  { table: "department_presidents", nom: r => r.full_name, complet: true },
  { table: "mayors", nom: r => r.full_name || `${r.first_name} ${r.last_name}`, complet: true, filtre: q => q.not("bio->controverses", "is", null) },
];

// Toutes les fiches sont chargées à chaque passage, même en périmètre prioritaire :
// un candidat également député voit ainsi ses deux fiches mises à jour ensemble.
async function chargerPersonnes(): Promise<Personne[]> {
  const parCle = new Map<string, Personne>();
  for (const t of TABLES) {
    const champs = t.table === "deputies" || t.table === "senators" ? "slug, first_name, last_name, bio"
      : t.table === "mayors" ? "slug, full_name, first_name, last_name, bio" : "slug, full_name, bio";
    let q: any = supabase.from(t.table).select(champs).not("bio", "is", null).limit(5000);
    if (t.filtre) q = t.filtre(q);
    const { data, error } = await q;
    if (error) { console.warn(`[Veille] ${t.table} illisible : ${error.message}`); continue; }
    for (const r of data || []) {
      if (!r.bio || typeof r.bio !== "object" || Array.isArray(r.bio)) continue;
      const nom = t.nom(r).trim();
      const cle = norm(nom);
      if (!cle || cle.split(" ").length < 2) continue;
      // Un maire homonyme d'un parlementaire n'est pas la même personne (cumul
      // interdit) : on ne mélange pas leurs fiches.
      if (t.table === "mayors" && parCle.has(cle)) continue;
      const fiche: Fiche = { table: t.table, slug: r.slug, nom, bio: r.bio, controverses: Array.isArray(r.bio.controverses) ? r.bio.controverses : [] };
      const p = parCle.get(cle);
      if (p) { p.fiches.push(fiche); p.prioritaire ||= !t.complet; }
      else parCle.set(cle, { cle, nom, fiches: [fiche], prioritaire: !t.complet });
    }
  }
  return [...parCle.values()];
}

// ── La presse ─────────────────────────────────────────────────────────────────

function nettoyerTitre(brut: string): { titre: string; media: string } {
  const i = brut.lastIndexOf(" - ");
  return i > 0 ? { titre: brut.slice(0, i).trim(), media: brut.slice(i + 3).trim() } : { titre: brut.trim(), media: "" };
}

let refusGoogle = 0;
async function articles(p: Personne): Promise<Article[] | null> {
  const requete = `"${p.nom}" (${MOTS_AFFAIRE.join(" OR ")}) when:${JOURS}d`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(requete)}&hl=fr&gl=FR&ceid=FR:fr`;
  let feed;
  try { feed = await parser.parseURL(url); refusGoogle = 0; }
  catch (e: any) {
    // 429/503 : Google freine. Une pause, puis on abandonne le passage s'il insiste.
    if (/Status code (429|503)/.test(String(e?.message))) { refusGoogle++; await sleep(60000); }
    return null;
  }
  const nomFamille = norm(p.nom).split(" ").pop()!;
  const limite = Date.now() - (JOURS + 1) * 86400000;
  const tous = (feed.items || [])
    .map(it => ({ ...nettoyerTitre(it.title || ""), url: it.link || "", date: it.isoDate || "", extrait: (it.contentSnippet || "").slice(0, 300) }))
    // Le nom doit figurer dans le titre : sinon l'article parle d'autre chose
    // et ne fait que citer la personne.
    .filter(a => a.url && norm(a.titre).includes(nomFamille) && (!a.date || new Date(a.date).getTime() > limite))
    .sort((a, b) => a.date.localeCompare(b.date));
  // Les premiers articles (la révélation, la réponse de la personne) et les plus
  // récents (les suites) : une affaire très couverte noie sinon son point de départ.
  return tous.length <= 25 ? tous : [...tous.slice(0, 10), ...tous.slice(-15)];
}

// ── L'IA ──────────────────────────────────────────────────────────────────────

const CONSIGNE = `Tu tiens la rubrique « Controverses » de la fiche d'une personnalité politique française, sur un site d'information civique neutre et non partisan.
On te donne les entrées déjà listées et des titres de presse récents. Décide s'ils révèlent :
- une AFFAIRE NOUVELLE : mise en cause judiciaire (enquête, plainte, mise en examen, procès, condamnation, relaxe), révélation de presse sur un comportement ou des propos de la personne (enquête journalistique, documents), ou polémique majeure sur ses propres propos ou actes, reprise par plusieurs médias ;
- ou un DÉVELOPPEMENT NOTABLE d'une affaire déjà listée (preuves publiées, plainte, décision de justice) ;
- ou RIEN.
Ce qui n'est PAS une controverse : un désaccord politique, une critique de ses adversaires, un vote, une prise de position, une rumeur d'un seul média, une affaire qui concerne une autre personne, un sondage.

Si tu écris une entrée :
- Une à trois phrases, factuelles, datées, au conditionnel ou attribuées (« selon Mediapart », « accusé par… ») tant que la justice n'a pas tranché. Présomption d'innocence.
- Commence par le mois et l'année des faits rapportés : « Septembre 2026 : … ».
- Nomme les médias à l'origine des révélations.
- Donne TOUJOURS la réponse de la personne si les titres la rapportent (dément, conteste, porte plainte…).
- Aucun adjectif de jugement, aucune spéculation. N'ajoute AUCUN détail (support, date, pseudonyme, chiffre) qui ne figure pas mot pour mot dans les titres ou extraits fournis.

Réponds en JSON, un seul objet :
{"action":"aucune"}
ou {"action":"ajouter","texte":"…","date":"AAAA-MM-JJ","sources":[numéros des articles utilisés]}
ou {"action":"completer","index":numéro de l'entrée existante (à partir de 1),"texte":"entrée réécrite, qui intègre le développement","date":"AAAA-MM-JJ","sources":[…]}`;

async function juger(p: Personne, existantes: string[], arts: Article[]) {
  const liste = existantes.length ? existantes.map((c, i) => `${i + 1}. ${c}`).join("\n") : "(aucune)";
  const titres = arts.map((a, i) => `[${i + 1}] ${a.date.slice(0, 10)} · ${a.media} — ${a.titre}${a.extrait && !a.extrait.startsWith(a.titre) ? ` (${a.extrait})` : ""}`).join("\n");
  const rep = await resilientDeepSeek.createMessage({
    model: "deepseek-chat", max_tokens: 4000, responseFormat: "json_object",
    system: CONSIGNE,
    messages: [{ role: "user", content: `Personne : ${p.nom}\n\nEntrées déjà listées :\n${liste}\n\nArticles récents :\n${titres}` }],
  }, { timeoutMs: 75000 });
  const texte = rep.content[0]?.type === "text" ? rep.content[0].text : "";
  const m = texte.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// ── Recopie dans les fiches ───────────────────────────────────────────────────

/** Recopie les entrées consignées dans les fiches de chaque personne. Idempotent. */
async function appliquer(personnes: Personne[]) {
  const { data: entrees, error } = await supabase.from("controverses_veille")
    .select("id, personne_cle, texte, remplace, masquee, date_faits").order("id");   // ordre de détection : la dernière consignée finit en tête
  if (error) throw error;
  const parCle = new Map(personnes.map(p => [p.cle, p]));
  let modifiees = 0;
  for (const p of parCle.values()) {
    const siennes = (entrees || []).filter(e => e.personne_cle === p.cle);
    if (!siennes.length) continue;
    for (const f of p.fiches) {
      let liste = [...f.controverses];
      for (const e of siennes) {
        // Les entrées que celle-ci a remplacées (chaîne de compléments) disparaissent.
        if (e.remplace) liste = liste.filter(c => norm(c) !== norm(e.remplace));
        if (e.masquee) { liste = liste.filter(c => norm(c) !== norm(e.texte)); continue; }
        if (!liste.some(c => norm(c) === norm(e.texte))) liste.unshift(e.texte);   // la plus récente en tête
      }
      if (JSON.stringify(liste) === JSON.stringify(f.controverses)) continue;
      const bio = { ...f.bio, controverses: liste };
      const { error: err } = await supabase.from(f.table).update({ bio }).eq("slug", f.slug);
      if (err) { console.warn(`[Veille] ${f.table}/${f.slug} non mis à jour : ${err.message}`); continue; }
      f.controverses = liste; f.bio = bio; modifiees++;
    }
  }
  console.log(`[Veille] ${modifiees} fiche(s) mise(s) à jour.`);
}

// ── Passage ───────────────────────────────────────────────────────────────────

async function main() {
  const complet = process.env.VEILLE_PERIMETRE === "complet";
  const personnes = await chargerPersonnes();
  const cible = process.env.VEILLE_PERSONNE ? norm(process.env.VEILLE_PERSONNE) : null;
  const surveillees = personnes.filter(p => cible ? p.cle === cible : complet || p.prioritaire);
  console.log(`[Veille] ${surveillees.length} personnalité(s) surveillée(s) — périmètre ${complet ? "complet" : "prioritaire"}, ${JOURS} derniers jours.`);

  if (process.env.VEILLE_APPLIQUER_SEUL !== "1") {
    let examinees = 0, ajouts = 0, complements = 0, echecs = 0, quotaVide = 0;
    for (const p of surveillees) {
      if (refusGoogle >= 3) { console.log("::warning::Google News refuse les requêtes : passage interrompu."); break; }
      const arts = await articles(p);
      await sleep(1200);
      if (!arts?.length) continue;
      const { data: vus } = await supabase.from("controverses_articles_vus").select("url").in("url", arts.map(a => a.url));
      const deja = new Set((vus || []).map(v => v.url));
      const neufs = arts.filter(a => !deja.has(a.url));
      if (!neufs.length) continue;

      // Entrées actuelles : celles de la fiche la plus fournie, plus celles déjà consignées.
      const existantes = [...p.fiches].sort((a, b) => b.controverses.length - a.controverses.length)[0].controverses;
      examinees++;
      let avis;
      try { avis = await juger(p, existantes, neufs); quotaVide = 0; }
      catch (e: any) {
        echecs++;
        if (/Aucun modèle gratuit disponible/.test(String(e?.message))) {
          if (++quotaVide >= 2) { console.log("::warning::Quota gratuit du jour épuisé : passage interrompu, reprise au prochain."); break; }
          await sleep(300000);
        }
        continue;   // articles non marqués « vus » : réexaminés au prochain passage
      }
      await supabase.from("controverses_articles_vus").upsert(neufs.map(a => ({ url: a.url, personne_cle: p.cle })), { onConflict: "url" });
      if (!avis || !["ajouter", "completer"].includes(avis.action) || !avis.texte) continue;

      const sources = (Array.isArray(avis.sources) ? avis.sources : [])
        .map((n: number) => neufs[n - 1]).filter(Boolean)
        .map((a: Article) => ({ titre: a.titre, media: a.media, url: a.url, date: a.date }));
      const medias = new Set(sources.map((s: any) => norm(s.media)).filter(Boolean));
      const remplace = avis.action === "completer" ? existantes[Number(avis.index) - 1] ?? null : null;
      // Une affaire nouvelle rapportée par un seul média n'entre pas : trop fragile
      // pour la fiche publique d'une personne. Un développement d'une affaire déjà
      // établie peut, lui, ne venir que d'une source.
      if (!remplace && medias.size < 2) { console.log(`[Veille] ${p.nom} : écarté (un seul média) — ${avis.texte}`); continue; }

      const date = /^\d{4}-\d{2}-\d{2}$/.test(avis.date || "") ? avis.date : new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from("controverses_veille").insert({
        personne_cle: p.cle, personne: p.nom, texte: String(avis.texte).trim(), date_faits: date, sources, remplace,
      });
      if (error) { console.warn(`[Veille] ${p.nom} : enregistrement impossible (${error.message})`); continue; }
      if (remplace) complements++; else ajouts++;
      console.log(`[Veille] ${p.nom} : ${remplace ? "complété" : "ajouté"} — ${avis.texte}`);
    }
    console.log(`[Veille] ${examinees} personne(s) avec articles neufs, ${ajouts} affaire(s) ajoutée(s), ${complements} complétée(s), ${echecs} échec(s) IA.`);
    if (examinees >= 5 && echecs > examinees / 2) console.log(`::warning::${echecs} jugements sur ${examinees} ont échoué.`);
  }

  await appliquer(personnes);
  // Les articles vus de plus de 60 jours ne reviendront plus dans une recherche bornée à quelques jours.
  await supabase.from("controverses_articles_vus").delete().lt("vu_le", new Date(Date.now() - 60 * 86400000).toISOString());
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
