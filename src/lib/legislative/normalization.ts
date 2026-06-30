import { createHash } from "node:crypto";

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

const CATEGORY_RULES: Array<[LegislativeCategory, RegExp]> = [
  ["economy_finance", /\b(finances?|fiscal|imp[oô]t|budget|économ|entreprise|consommation)\b/i],
  ["social_labour", /\b(travail|emploi|social|retraite|enfance|famille|solidarit|handicap)\b/i],
  ["health", /\b(santé|médic|h[oô]pital|soins?|pharmacie|sécurité sociale)\b/i],
  ["education_culture", /\b(éducation|enseignement|école|universit|culture|patrimoine|sport)\b/i],
  ["environment_agriculture", /\b(environnement|climat|énergie|agric|biodiversité|écolog|forêt|eau)\b/i],
  ["justice_security", /\b(justice|pénal|sécurité|police|gendarmerie|terrorisme|immigration)\b/i],
  ["institutions", /\b(constitution|élection|parlement|institution|collectivité|mandat)\b/i],
  ["defence_international", /\b(défense|armée|militaire|international|européen|diplomatie|traité)\b/i],
  ["territories_housing", /\b(logement|urbanisme|territoire|commune|département|région|transport|mobilité)\b/i],
];

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

export function classifyLegislativeText(text: string): LegislativeCategory {
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function normalizeDossier(input: RawOfficialDossier): NormalizedDossier {
  const isGovernment = /projet de loi/i.test(input.procedureLabel);
  const sourceUpdatedAt = input.sourceUpdatedAt ?? new Date().toISOString();
  const normalized = {
    officialId: input.uid.trim(),
    legislature: 17,
    title: input.title.trim(),
    textType: isGovernment ? "bill" as const : "proposal" as const,
    authorKind: isGovernment ? "government" as const : "parliamentarian" as const,
    authorName: isGovernment ? "Le Gouvernement" : input.authorNames.filter(Boolean).join(", ") || null,
    category: classifyLegislativeText(`${input.title} ${input.procedureLabel}`),
    statusCode: "filed" as const,
    statusLabel: "Déposé" as const,
    currentChamber: "AN" as const,
    depositedAt: input.depositedAt ?? null,
    sourceUrls: [input.sourceUrl],
    sourceUpdatedAt,
  };
  const { sourceUpdatedAt: _fetchedAt, ...officialFacts } = normalized;
  return { ...normalized, sourceHash: stableHash(officialFacts) };
}

function normalizeForMatch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\W+/g, " ").trim();
}

export function promoteFromJorf(dossier: NormalizedDossier, record: JorfRecord) {
  if (record.nature.toUpperCase() !== "LOI") return null;
  const a = normalizeForMatch(dossier.title);
  const b = normalizeForMatch(record.title);
  const titleMatches = a === b || a.includes(b) || b.includes(a);
  if (!titleMatches) return null;
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
