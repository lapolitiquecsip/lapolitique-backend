// Domaines d'intérêt pour les notifications personnalisées (moteur de matching).
// COPIE synchronisée du frontend : politique-pour-tous/src/lib/data/interestDomains.ts
// (codes + mots-clés IDENTIQUES). Si l'un change, mettre l'autre à jour.

export interface InterestDomain {
  code: string;
  label: string;
  keywords: string[];
}

export const INTEREST_DOMAINS: InterestDomain[] = [
  { code: "economie", label: "Économie & finances",
    keywords: ["budget", "fiscal", "impôt", "impot", "taxe", "déficit", "deficit", "dette", "finances", "économie", "economie", "croissance", "inflation", "pouvoir d'achat"] },
  { code: "emploi", label: "Emploi & travail",
    keywords: ["emploi", "travail", "chômage", "chomage", "salaire", "smic", "syndicat", "licenciement", "assurance chômage", "code du travail"] },
  { code: "retraites", label: "Retraites",
    keywords: ["retraite", "pension", "âge légal", "age legal", "cotisation"] },
  { code: "sante", label: "Santé",
    keywords: ["santé", "sante", "hôpital", "hopital", "sécurité sociale", "securite sociale", "médecin", "medecin", "soins", "médicament", "medicament", "psychiatrie"] },
  { code: "education", label: "Éducation",
    keywords: ["éducation", "education", "école", "ecole", "enseignant", "université", "universite", "élève", "eleve", "collège", "college", "lycée", "lycee", "baccalauréat", "baccalaureat"] },
  { code: "ecologie", label: "Écologie & énergie",
    keywords: ["écologie", "ecologie", "climat", "énergie", "energie", "environnement", "carbone", "renouvelable", "nucléaire", "nucleaire", "biodiversité", "biodiversite", "pollution"] },
  { code: "agriculture", label: "Agriculture & ruralité",
    keywords: ["agriculture", "agricole", "agriculteur", "élevage", "elevage", "pêche", "peche", "rural", "alimentation", "ferme"] },
  { code: "securite", label: "Sécurité & justice",
    keywords: ["sécurité", "securite", "police", "gendarmerie", "justice", "délinquance", "delinquance", "prison", "tribunal", "terrorisme", "violence"] },
  { code: "immigration", label: "Immigration",
    keywords: ["immigration", "asile", "étranger", "etranger", "migrant", "frontière", "frontiere", "naturalisation", "séjour", "sejour", "ofpra"] },
  { code: "europe", label: "Europe & international",
    keywords: ["europe", "européen", "europeen", "union européenne", "commission européenne", "international", "otan", "diplomatie", "diplomatique"] },
  { code: "social", label: "Social & solidarités",
    keywords: ["social", "solidarité", "solidarite", "rsa", "allocation", "handicap", "pauvreté", "pauvrete", "famille", "aide sociale", "logement social"] },
  { code: "logement", label: "Logement & territoires",
    keywords: ["logement", "immobilier", "loyer", "urbanisme", "collectivité", "collectivite", "commune", "aménagement", "amenagement", "territoire", "dpe"] },
  { code: "institutions", label: "Institutions & démocratie",
    keywords: ["constitution", "référendum", "referendum", "élection", "election", "démocratie", "democratie", "institution", "réforme", "reforme", "assemblée", "assemblee", "sénat", "senat"] },
  { code: "numerique", label: "Numérique & libertés",
    keywords: ["numérique", "numerique", "internet", "données", "donnees", "intelligence artificielle", "vie privée", "vie privee", "cnil", "réseaux sociaux", "reseaux sociaux", "cyber"] },
];

const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Domaines rattachés à un texte (titre + résumé), par recherche de mots-clés.
export function matchDomains(text: string): string[] {
  const t = norm(text);
  const hits: string[] = [];
  for (const d of INTEREST_DOMAINS) {
    if (d.keywords.some(k => t.includes(norm(k)))) hits.push(d.code);
  }
  return hits;
}
