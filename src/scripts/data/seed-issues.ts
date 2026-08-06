import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../../config/supabase.js";

// Fondation Brique #3 — Référentiel canonique des ENJEUX (18). Les `keywords` couvrent le
// vocabulaire GRAND PUBLIC (pas seulement institutionnel) : ils servent À LA FOIS à taguer les
// scrutins (les "actes") et à résoudre la recherche de l'utilisateur ("guerre"→ukraine-russie).
// Idempotent (upsert par slug).

export const ISSUES: Array<{ slug: string; title: string; category: string; sort_order: number; keywords: string[] }> = [
  // ── Régaliens ──────────────────────────────────────────────────────────────
  { slug: "immigration", title: "Immigration", category: "Régaliens", sort_order: 1,
    keywords: ["immigration","immigré","immigration clandestine","migrant","migratoire","étranger","sans-papiers","clandestin","oqtf","asile","réfugié","demandeur d'asile","aide médicale d'état","ame","frontière","expulsion","reconduite","naturalisation","titre de séjour","visa","regroupement familial","schengen","droit du sol","intégration"] },
  { slug: "securite-justice", title: "Sécurité & justice", category: "Régaliens", sort_order: 2,
    keywords: ["sécurité","insécurité","délinquance","police","policier","gendarmerie","forces de l'ordre","justice","peine","prison","pénitentiaire","détenu","pénal","criminalité","violence","agression","tribunal","magistrat","récidive","drogue","stupéfiants","trafic","narcotrafic","point de deal","vidéosurveillance"] },
  { slug: "laicite", title: "Laïcité", category: "Régaliens", sort_order: 3,
    keywords: ["laïcité","laïque","voile","foulard","abaya","religion","religieux","signes religieux","séparatisme","islamisme","islam","culte","neutralité","concordat"] },
  { slug: "defense", title: "Défense & armée", category: "Régaliens", sort_order: 4,
    keywords: ["défense","armée","militaire","soldat","guerre","otan","dissuasion","loi de programmation militaire","lpm","armement","budget militaire","opex","réserve militaire","service national","industrie de défense"] },
  { slug: "institutions", title: "Institutions & démocratie", category: "Régaliens", sort_order: 5,
    keywords: ["constitution","référendum","proportionnelle","vie république","cinquième république","49.3","49-3","motion de censure","institutions","réforme institutionnelle","mode de scrutin","décentralisation","cumul des mandats","démocratie","abstention","droit de vote"] },

  // ── Économie & social ──────────────────────────────────────────────────────
  { slug: "retraites", title: "Retraites", category: "Économie & social", sort_order: 6,
    keywords: ["retraite","retraites","pension","âge légal","64 ans","62 ans","réforme des retraites","cotisation retraite","régime spécial","carrière longue","départ à la retraite","trimestres"] },
  { slug: "fiscalite", title: "Fiscalité & impôts", category: "Économie & social", sort_order: 7,
    keywords: ["impôt","impôts","fiscalité","fiscal","taxe","taxation","tva","isf","impôt sur la fortune","niche fiscale","prélèvement","fisc","patrimoine","héritage","succession","flat tax","csg","impôt sur le revenu","exonération"] },
  { slug: "pouvoir-achat", title: "Pouvoir d'achat", category: "Économie & social", sort_order: 8,
    keywords: ["pouvoir d'achat","inflation","prix","hausse des prix","cherté","coût de la vie","salaire","smic","carburant","essence","facture d'énergie","panier","indexation","vie chère","fin du mois"] },
  { slug: "travail-emploi", title: "Travail & emploi", category: "Économie & social", sort_order: 9,
    keywords: ["emploi","chômage","chômeur","travail","rsa","assurance chômage","france travail","apprentissage","code du travail","licenciement","temps de travail","35 heures","syndicat","grève","salarié","précarité","cdd","intérim","télétravail"] },
  { slug: "sante", title: "Santé", category: "Économie & social", sort_order: 10,
    keywords: ["santé","hôpital","hospitalier","médecin","soignant","soins","sécurité sociale","assurance maladie","désert médical","urgences","remboursement","ars","ehpad","dépendance","psychiatrie","maladie","pénurie de médicaments","fin de vie"] },
  { slug: "logement", title: "Logement", category: "Économie & social", sort_order: 11,
    keywords: ["logement","loyer","hlm","logement social","immobilier","dpe","passoire thermique","encadrement des loyers","mal-logement","apl","aide au logement","construction de logements","propriétaire","locataire","airbnb","meublé touristique","sdf","hébergement d'urgence"] },
  { slug: "education", title: "Éducation", category: "Économie & social", sort_order: 12,
    keywords: ["école","éducation","éducation nationale","enseignant","professeur","instituteur","collège","lycée","élève","programme scolaire","réforme scolaire","baccalauréat","harcèlement scolaire","uniforme","rythmes scolaires","carte scolaire","décrochage"] },

  // ── Écologie & énergie ─────────────────────────────────────────────────────
  { slug: "climat", title: "Climat & environnement", category: "Écologie & énergie", sort_order: 13,
    keywords: ["climat","climatique","écologie","carbone","co2","gaz à effet de serre","réchauffement","environnement","biodiversité","pollution","zfe","zone à faibles émissions","transition écologique","énergies renouvelables","éolien","éolienne","solaire","photovoltaïque","déchets","eau","canicule","sécheresse"] },
  { slug: "nucleaire", title: "Nucléaire (énergie)", category: "Écologie & énergie", sort_order: 14,
    keywords: ["nucléaire","epr","centrale nucléaire","réacteur","edf","atome","uranium","déchets nucléaires","électricité nucléaire","fessenheim","prolongation des centrales"] },
  { slug: "agriculture", title: "Agriculture", category: "Écologie & énergie", sort_order: 15,
    keywords: ["agriculture","agriculteur","paysan","monde agricole","pac","politique agricole","élevage","éleveur","pesticide","glyphosate","souveraineté alimentaire","alimentation","ferme","foncier agricole","mercosur","viticulture","pêche","revenu agricole"] },

  // ── International ───────────────────────────────────────────────────────────
  { slug: "ukraine-russie", title: "Ukraine / Russie", category: "International", sort_order: 16,
    keywords: ["ukraine","ukrainien","russie","russe","poutine","zelensky","guerre en ukraine","otan","kiev","moscou","invasion","sanctions russes","aide militaire à l'ukraine","livraison d'armes","donbass","crimée"] },
  { slug: "europe-ue", title: "Union européenne", category: "International", sort_order: 17,
    keywords: ["europe","européen","union européenne","ue","bruxelles","commission européenne","souveraineté européenne","zone euro","frexit","directive européenne","règlement européen","parlement européen","élargissement","traité européen"] },

  // ── Numérique ───────────────────────────────────────────────────────────────
  { slug: "numerique", title: "Numérique & tech", category: "Numérique", sort_order: 18,
    keywords: ["numérique","internet","réseaux sociaux","intelligence artificielle","ia","données personnelles","rgpd","cybersécurité","plateforme","tiktok","gafam","désinformation","fake news","fracture numérique","souveraineté numérique","cloud"] },
];

async function main() {
  // La table `issues` préexiste (référentiel candidats, proposition NOT NULL). On NE TOUCHE PAS
  // les enjeux existants (titre/proposition/ordre curés) : on met seulement à jour leurs keywords ;
  // les nouveaux enjeux sont insérés avec proposition='' (→ exclus du comparateur candidats côté front).
  const { data: existing, error: exErr } = await supabase.from("issues").select("slug");
  if (exErr) throw exErr;
  const have = new Set((existing || []).map(r => r.slug));

  let updated = 0;
  for (const i of ISSUES.filter(x => have.has(x.slug))) {
    const { error } = await supabase.from("issues").update({ keywords: i.keywords }).eq("slug", i.slug);
    if (error) { console.error(`update ${i.slug}:`, error.message); continue; }
    updated++;
  }

  const news = ISSUES.filter(x => !have.has(x.slug))
    .map(i => ({ slug: i.slug, title: i.title, category: i.category, sort_order: i.sort_order, keywords: i.keywords, proposition: "" }));
  if (news.length) {
    const { error } = await supabase.from("issues").insert(news);
    if (error) throw error;
  }
  console.log(`Référentiel enjeux : ${updated} existants mis à jour (keywords), ${news.length} nouveaux insérés → ${have.size + news.length} au total.`);
  if (news.length) console.log("Nouveaux :", news.map(n => n.slug).join(", "));
}

// Ne s'exécute que si lancé directement (pas lors de l'import de ISSUES par le tagger).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(e => { console.error(e); process.exit(1); });
