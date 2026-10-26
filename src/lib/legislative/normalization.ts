import { createHash } from "node:crypto";
import { CATEGORIES_CORRIGEES } from "./categories-corrigees.js";

export const LEGISLATIVE_CATEGORIES = [
  "economy_finance",
  "social_labour",
  "health",
  "education_culture",
  "environment_agriculture",
  "justice_security",
  "institutions",
  "defence_international",
  "territories_housing",
  "other",
] as const;

export type LegislativeCategory = (typeof LEGISLATIVE_CATEGORIES)[number];

// Classement thématique d'un texte par son intitulé.
//
// L'ancienne version retenait la PREMIÈRE règle qui « matchait », avec des mots trop larges :
// « le transport et le stockage de pesticides » finissait en Territoires & logement,
// « la famille des néonicotinoïdes » en Social, « le cadre européen relatif aux pesticides »
// en Défense & international. Et `\b` ne marche pas devant une lettre accentuée en
// JavaScript : « éducation », « énergie », « élection » n'étaient jamais reconnus.
//
// Désormais : texte sans accents, chaque thème marque des points (3 pour un mot qui désigne
// le sujet, 1 pour un mot d'appoint qui peut n'être que le cadre : « européen »,
// « territoire », « transport »…), et le meilleur total l'emporte. À égalité, l'ordre de la
// liste départage (thèmes les plus spécifiques d'abord).
type Indice = [RegExp, number];
const THEMES: Array<[LegislativeCategory, Indice[]]> = [
  ["environment_agriculture", [
    [/\b(pesticid|phytosanitaire|phytopharmaceutique|neonicotino|glyphosate|acetamipride)/, 3],
    [/\b(agricult|agricole|agroalimentaire|elevage|eleveur|semence|irrigation|viticult|apicult)/, 3],
    [/\b(environnement|biodiversit|climat|ecolog|pollution|dechet|recyclage|plastique|artificialisation)/, 3],
    [/\b(energie|energetique|renouvelable|eolien|photovoltaique|hydrogene|carbone|electricite)/, 3],
    [/\bnucleaire/, 2],
    [/\b(foret|forestier|peche|pecheur|chasse|chasseur|montagne|littoral|loup|frelon|animaux|animal|faune|flore)/, 3],
    [/\b(diversite biologique|ocean|milieu marin|eau potable|ressource en eau|assainissement|secheresse)/, 3],
    [/\beaux?\b/, 2],
    [/\b(alimentation|alimentaire)/, 1],
  ]],
  ["health", [
    [/\b(sante|medica|medicament|medecin|hopital|hospitali|soins|pharmac|maladie|patient|infirmier|cancer|vaccin|psychiatr|psycholog|addiction)/, 3],
    [/\b(fin de vie|aide a mourir|soins palliatifs|cardio|assurance maladie)/, 3],
    [/\bsanitaire/, 1],
  ]],
  ["defence_international", [
    [/\b(defense nationale|code de la defense|industrie de defense|dissuasion|armee|armees|militaire|otan|guerre|anciens combattants)/, 3],
    [/\b(reserviste|reserve operationnelle|reserve citoyenne|garde nationale|service national)/, 3],
    [/\b(autorisant l (approbation|adhesion|ratification)|(ratification|approbation) (de l |de la |des |du )?(accord|convention|traite|protocole|avenant))/, 4],
    [/\b(extradition|entraide judiciaire|diplomati|ingerence|nations unies|onu|libre echange|accord d association)/, 3],
    [/\b(etats unis|russie|ukraine|israel|palestin|gaza|iran|chine|liban|syrie|afrique)/, 2],
    [/\b(accord|convention|traite) (entre|de cooperation|portant|relatif|sur)/, 2],
    [/\bdefense\b/, 2],
    [/\b(international|internationale|europeen|europeenne|union europeenne|a l etranger)/, 1],
  ]],
  ["justice_security", [
    [/\b(justice|penal|penitentiaire|prison|detenu|peine|delinquan|terroris|narcotrafic|stupefiant)/, 3],
    [/(crimin|police|policier|gendarmerie|forces de l ordre|ordre public|legitime defense|casseur|violence|viol\b|victime|fraude)/, 3],
    [/\b(immigration|asile|titre de sejour|retention administrative|nationalite|expulsion|obligation de quitter le territoire)/, 3],
    [/\betrangers\b/, 2],
    [/\b(incendie|pompier|securite civile)/, 3],
    [/\bjudiciaire/, 2],
    [/\bsecurite\b(?! sociale)/, 1],
  ]],
  ["education_culture", [
    [/\b(education|enseignement|ecole|scolaire|universit|etudiant|recherche scientifique|lycee|college|parcoursup)/, 3],
    [/\b(des|les|aux|d) eleves\b/, 3],
    [/\b(culture|culturel|musee|cinema|livres?\b|edition|audiovisuel|presse|langue|spectacle|biens culturels)/, 3],
    [/\b(sport|sportif|jeux olympiques|paralympiques)/, 3],
    [/\bpatrimoine\b(?! immobilier)/, 1],
  ]],
  ["social_labour", [
    [/\b(travail|emploi|employeur|salari|chomage|retraite|pension|apprenti|syndicat|syndicaux|dialogue social|titre restaurant|teletravail)/, 3],
    [/\b(assurance chomage|assurance vieillesse|duree d assurance)/, 3],
    [/\b(enfance|enfant|mineur|famille|familial|parent|aidant|handicap|solidarit|pauvrete|minima sociaux|rsa|allocation)/, 2],
    [/\b(securite sociale|protection sociale|prestation)/, 2],
    [/\bmedico social/, 3],
    [/\bsocial|sociaux|sociale/, 1],
  ]],
  ["economy_finance", [
    [/\b(loi de finances|finances publiques|fiscal|impot|imposition|taxe|taxation|tva|budget|dette|douane|epargne)/, 3],
    [/\b(econom|entreprise|commerce|commercial|consommat|banque|bancaire|credit|industri|concurrence|liquidation)/, 3],
    [/\b(finance|financement|financier|prix|assurance)/, 1],
  ]],
  ["territories_housing", [
    [/\b(logement|urbanisme|locatif|loyer|bail|copropriete|habitat|meubles de tourisme)/, 3],
    [/\b(transport|mobilite|ferroviaire|routier|aerien|portuaire)/, 2],
    [/\b(commune|communal|intercommunal|departement|region|metropole|ruralit|rural|amenagement)/, 2],
    [/\b(territoire|territorial|outre mer|immobilier)/, 1],
  ]],
  ["institutions", [
    [/\b(constitution|constitutionnel|election|electoral|scrutin|referendum|parlement|mandat|elu local|elus locaux)/, 3],
    [/\b(nouvelle caledonie|corse|polynesie|collectivite|deontologie|lobbying|vie publique|fonction publique|partis politiques)/, 2],
    [/\b(conseil economique social et environnemental|cese)\b/, 6],
  ]],
];

export function classifyLegislativeText(text: string): LegislativeCategory {
  const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    // L'intitulé de procédure (« proposition de résolution européenne ») ne dit rien du sujet.
    .replace(/\b(proposition|projet) de (loi|resolution)( organique| europeenne| constitutionnelle)?\b/g, " ");
  let best: LegislativeCategory = "other", bestScore = 0;
  for (const [category, indices] of THEMES) {
    const score = indices.reduce((sum, [motif, poids]) => sum + (motif.test(t) ? poids : 0), 0);
    if (score > bestScore) { best = category; bestScore = score; }
  }
  return best;
}

/** Catégorie d'un dossier : la correction manuelle (categories-corrigees.ts) prime sur le classeur. */
export function classifyDossier(officialId: string, text: string): LegislativeCategory {
  return CATEGORIES_CORRIGEES[officialId] ?? classifyLegislativeText(text);
}

export interface RawOfficialDossier {
  uid: string;
  title: string;
  procedureLabel: string;
  authorNames: string[];
  sourceUrl: string;
  depositedAt?: string | null;
  sourceUpdatedAt?: string | null;
}

export interface NormalizedDossier {
  officialId: string;
  legislature: number;
  title: string;
  textType: "bill" | "proposal";
  authorKind: "government" | "parliamentarian";
  authorName: string | null;
  category: LegislativeCategory;
  statusCode: string;
  statusLabel: string;
  currentChamber: "AN" | "SENAT" | "CMP" | "CC" | "JORF";
  depositedAt: string | null;
  sourceUrls: string[];
  sourceUpdatedAt: string;
  sourceHash: string;
}

export interface JorfRecord {
  nature: string;
  nor: string;
  title: string;
  publishedAt: string;
  sourceUrl: string;
  eli?: string | null;
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function normalizeDossier(input: RawOfficialDossier): NormalizedDossier {
  const isGovernment = /projet de loi/i.test(input.procedureLabel);
  const sourceUpdatedAt = input.sourceUpdatedAt ?? new Date().toISOString();
  const normalized = {
    officialId: input.uid.trim(),
    // Etait fige a 17 : les dossiers de la legislature 16 etaient donc enregistres
    // sous l'etiquette 17, corrompant tout filtrage par legislature. On la deduit
    // desormais de l'identifiant officiel (ex. DLR5L16N50072 -> 16).
    legislature: (() => {
      const m = input.uid.trim().match(/DLR5L(\d+)/i);
      return m ? parseInt(m[1], 10) : parseInt(process.env.AN_LEGISLATURE || "17", 10);
    })(),
    title: input.title.trim(),
    textType: isGovernment ? "bill" as const : "proposal" as const,
    authorKind: isGovernment ? "government" as const : "parliamentarian" as const,
    authorName: isGovernment ? "Le Gouvernement" : input.authorNames.filter(Boolean).join(", ") || null,
    category: classifyDossier(input.uid.trim(), `${input.title} ${input.procedureLabel}`),
    statusCode: "filed" as const,
    statusLabel: "Déposé" as const,
    currentChamber: "AN" as const,
    depositedAt: input.depositedAt ?? null,
    sourceUrls: [input.sourceUrl],
    sourceUpdatedAt,
  };
  // La catégorie est notre classement, pas un fait de la source : hors empreinte, une
  // retouche du classeur ne fait pas passer tous les dossiers pour modifiés.
  const { sourceUpdatedAt: _fetchedAt, category: _category, ...officialFacts } = normalized;
  return { ...normalized, sourceHash: stableHash(officialFacts) };
}

function normalizeForMatch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\W+/g, " ").trim();
}

function canonicalLegislativeTitle(value: string): string {
  return normalizeForMatch(value)
    .replace(/^loi(?: organique)? n [0-9 -]+ du [0-9]+ [a-z]+ [0-9]+ /, "")
    .replace(/^(?:projet|proposition) de loi(?: organique)? /, "")
    .replace(/^(?:visant|tendant) a /, "")
    .replace(/^relati(?:f|ve) a /, "")
    .replace(/^(?:portant|autorisant|facilitant) /, "")
    .trim();
}

// Années (millésimes) présentes dans un titre — décisives pour les textes budgétaires
// (« pour 2025 » vs « pour 2026 ») et les ratifications datées.
function titleYears(canonical: string): Set<string> {
  return new Set((canonical.match(/\b(?:19|20)\d{2}\b/g) || []));
}

// Un texte qui ABROGE une loi contient forcément l'intitulé de cette loi ; il ne doit
// jamais être confondu avec la loi elle-même lors du rattachement JORF → dossier.
const ABROGATION_RE = /\b(abroger|abrogation|abrogeant|supprimer la loi|revenir sur la loi)\b/;

export function legislativeTitleMatchScore(left: string, right: string): number {
  const a = canonicalLegislativeTitle(left);
  const b = canonicalLegislativeTitle(right);
  // Années incompatibles (budget/ratification) : ce n'est pas le même texte.
  const ya = titleYears(a), yb = titleYears(b);
  if (ya.size && yb.size && ![...ya].some(y => yb.has(y))) return 0;
  // Seule l'égalité stricte vaut 1 : l'inclusion (« ... abroger la loi visant à ... »)
  // reste forte mais NE DOIT PAS égaler un titre identique, sinon le texte adverse gagne.
  if (a === b) return 1;
  const ignored = new Set(["a", "au", "aux", "de", "des", "du", "d", "et", "en", "la", "le", "les", "l", "pour", "par", "sur", "un", "une"]);
  const tokensA = new Set(a.split(" ").filter(token => token.length > 1 && !ignored.has(token)));
  const tokensB = new Set(b.split(" ").filter(token => token.length > 1 && !ignored.has(token)));
  if (!tokensA.size || !tokensB.size) return 0;
  const common = [...tokensA].filter(token => tokensB.has(token)).length;
  const dice = (2 * common) / (tokensA.size + tokensB.size);
  // Un côté abroge/vise l'autre ? Signal fort d'un texte adverse : on ne remonte pas à 1.
  const opposing = (ABROGATION_RE.test(a) && !ABROGATION_RE.test(b)) || (ABROGATION_RE.test(b) && !ABROGATION_RE.test(a));
  if ((a.includes(b) || b.includes(a)) && !opposing) return Math.max(dice, 0.85);
  return dice;
}

export function promoteFromJorf(dossier: NormalizedDossier, record: JorfRecord) {
  if (record.nature.toUpperCase() !== "LOI") return null;
  if (legislativeTitleMatchScore(dossier.title, record.title) < 0.5) return null;
  // Une loi ne peut pas être promulguée AVANT le dépôt de son texte. Sans ce garde-fou, une
  // archive DILA qui rejoue d'anciennes éditions (1991, 2008…) rattachait par simple
  // ressemblance de titre une vieille loi à un texte déposé en 2025 ou 2026, qui
  // s'affichait alors « promulgué » sur le site (28 cas relevés le 18/10/2026).
  if (dossier.depositedAt && record.publishedAt && record.publishedAt.slice(0, 10) < String(dossier.depositedAt).slice(0, 10)) return null;
  return {
    dossierOfficialId: dossier.officialId,
    jorfNor: record.nor,
    jorfId: record.eli ?? record.nor,
    title: record.title,
    promulgatedAt: record.publishedAt,
    sourceUrl: record.sourceUrl,
    sourceHash: stableHash(record),
  };
}
