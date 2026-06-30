import { normalizeDossier, stableHash, type NormalizedDossier } from "./normalization.js";

export interface NormalizedStep {
  officialId: string;
  code: string;
  label: string;
  chamber: "AN" | "SENAT" | "CMP" | "CC" | "JORF";
  occurredAt: string | null;
  sequence: number;
  sourceUrl: string;
  sourceHash: string;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function actorRefs(value: any): string[] {
  return asArray(value?.initiateur?.acteurs?.acteur)
    .map((actor: any) => actor?.acteurRef?.trim())
    .filter(Boolean);
}

function chamberFor(code: string): NormalizedStep["chamber"] {
  if (code.includes("CMP")) return "CMP";
  if (code.startsWith("SN")) return "SENAT";
  if (code.startsWith("CC")) return "CC";
  if (code.startsWith("PROM") || code.startsWith("JO")) return "JORF";
  return "AN";
}

function statusCodeFor(code: string): string {
  // AN workflow metadata may announce a promulgation/publication step, but the
  // canonical `promulgated` status is reserved for a matched DILA JORF record.
  if (/PROM|JO/.test(code)) return "awaiting_jorf_verification";
  if (/CC/.test(code)) return "constitutional_review";
  if (/CMP/.test(code)) return "joint_committee";
  if (/DEC|VOTE/.test(code)) return "voted";
  if (/COM/.test(code)) return "committee";
  if (/DEBAT|SEANCE/.test(code)) return "public_debate";
  return "filed";
}

function flattenActs(value: any, sourceUrl: string, output: Omit<NormalizedStep, "sequence">[] = []) {
  for (const act of asArray(value)) {
    if (!act || typeof act !== "object") continue;
    const code = String(act.codeActe ?? "UNKNOWN");
    const label = String(act.libelleActe?.libelleCourt ?? act.libelleActe?.nomCanonique ?? code);
    if (act.uid) {
      const step = {
        officialId: String(act.uid),
        code,
        label,
        chamber: chamberFor(code),
        occurredAt: act.dateActe ? new Date(act.dateActe).toISOString() : null,
        sourceUrl,
        sourceHash: "",
      };
      step.sourceHash = stableHash(step);
      output.push(step);
    }
    flattenActs(act.actesLegislatifs?.acteLegislatif, sourceUrl, output);
  }
  return output;
}

export function parseAssembleeDossier(raw: any, actorNames: Map<string, string>): { dossier: NormalizedDossier; steps: NormalizedStep[] } | null {
  const value = raw?.dossierParlementaire;
  if (!value || String(value.legislature) !== "17" || !String(value.uid ?? "").startsWith("DLR5L17")) return null;

  const chemin = value.titreDossier?.titreChemin;
  const sourceUrl = chemin
    ? `https://www.assemblee-nationale.fr/dyn/17/dossiers/${chemin}`
    : `https://data.assemblee-nationale.fr/dossier/${value.uid}`;
  const refs = actorRefs(value);
  const authors = refs.map(ref => actorNames.get(ref)).filter((name): name is string => Boolean(name));
  const unsequenced = flattenActs(value.actesLegislatifs?.acteLegislatif, sourceUrl);
  const steps = unsequenced
    .sort((a, b) => {
      if (a.occurredAt && b.occurredAt) return a.occurredAt.localeCompare(b.occurredAt) || a.officialId.localeCompare(b.officialId);
      if (a.occurredAt) return -1;
      if (b.occurredAt) return 1;
      return a.officialId.localeCompare(b.officialId);
    })
    .map((step, sequence) => ({ ...step, sequence }));
  const datedSteps = steps.filter(step => step.occurredAt);
  const latest = datedSteps.at(-1) ?? steps.at(-1);
  const deposited = datedSteps.find(step => /DEPOT/.test(step.code));

  const dossier = normalizeDossier({
    uid: value.uid,
    title: value.titreDossier?.titre ?? value.libelle ?? "Titre officiel indisponible",
    procedureLabel: value.procedureParlementaire?.libelle ?? "Proposition de loi",
    authorNames: authors,
    sourceUrl,
    depositedAt: deposited?.occurredAt?.slice(0, 10) ?? null,
    sourceUpdatedAt: new Date().toISOString(),
  });

  if (latest) {
    dossier.statusCode = statusCodeFor(latest.code);
    dossier.statusLabel = latest.label;
    dossier.currentChamber = latest.chamber;
    const { sourceUpdatedAt: _fetchedAt, ...officialFacts } = dossier;
    dossier.sourceHash = stableHash({ ...officialFacts, steps });
  }
  return { dossier, steps };
}
