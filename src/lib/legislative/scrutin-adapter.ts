import { stableHash } from "./normalization.js";

type DossierCandidate = { id: string; officialId: string; title: string };

const array = <T>(value: T | T[] | null | undefined): T[] => value == null ? [] : Array.isArray(value) ? value : [value];
const integer = (value: unknown) => Number.parseInt(String(value ?? "0"), 10) || 0;
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function findDossier(title: string, dossiers: DossierCandidate[]) {
  const haystack = normalized(title);
  return dossiers.find(dossier => haystack.includes(normalized(dossier.title)));
}

function outcome(value: string): "adopted" | "rejected" | "withdrawn" | "not_defended" | "pending" {
  const label = normalized(value);
  if (label.includes("adopte") && !label.includes("pas adopte") && !label.includes("rejet")) return "adopted";
  if (label.includes("rejet") || label.includes("pas adopte")) return "rejected";
  if (label.includes("retire")) return "withdrawn";
  if (label.includes("non soutenu")) return "not_defended";
  return "pending";
}

export function parseAssembleeScrutin(raw: any, dossiers: DossierCandidate[], actorNames: Map<string, string>) {
  const value = raw?.scrutin;
  // Legislature parametrable (voir normalization.ts) : figee, elle rejetait
  // silencieusement tous les scrutins anterieurs a la legislature en cours.
  const wantedLegislature = process.env.AN_LEGISLATURE || "17";
  if (!value || String(value.legislature) !== wantedLegislature || !value.uid || !value.dateScrutin) return null;
  const title = String(value.titre ?? value.objet?.libelle ?? "Scrutin public");
  const dossier = findDossier(title, dossiers);
  if (!dossier) return null;
  const sourceUrl = `https://www.assemblee-nationale.fr/dyn/17/scrutins/${value.numero}`;
  const groups = array(value.ventilationVotes?.organe?.groupes?.groupe);
  const votes: Array<{ voterOfficialId: string; voterName: string; groupCode: string; position: string }> = [];
  const positions = [["pours", "for"], ["contres", "against"], ["abstentions", "abstain"], ["nonVotants", "non_voting"]] as const;
  for (const group of groups as any[]) {
    for (const [field, position] of positions) {
      for (const voter of array(group.vote?.decompteNominatif?.[field]?.votant) as any[]) {
        if (!voter?.acteurRef) continue;
        votes.push({ voterOfficialId: voter.acteurRef, voterName: actorNames.get(voter.acteurRef) ?? voter.acteurRef, groupCode: group.organeRef, position });
      }
    }
  }
  const groupResults = (groups as any[]).map(group => ({
    groupCode: group.organeRef,
    forCount: integer(group.vote?.decompteVoix?.pour),
    againstCount: integer(group.vote?.decompteVoix?.contre),
    abstainCount: integer(group.vote?.decompteVoix?.abstentions),
    nonVotingCount: integer(group.vote?.decompteVoix?.nonVotants),
  }));
  const amendmentNumber = title.match(/amendement\s+n[°o]?\s*([\w.-]+)/i)?.[1] ?? null;
  const sourceUpdatedAt = new Date().toISOString();
  const scrutin = {
    officialId: value.uid,
    dossierId: dossier.id,
    chamber: "AN" as const,
    title,
    resultCode: String(value.sort?.code ?? ""),
    resultLabel: String(value.sort?.libelle ?? ""),
    forCount: integer(value.syntheseVote?.decompte?.pour),
    againstCount: integer(value.syntheseVote?.decompte?.contre),
    abstainCount: integer(value.syntheseVote?.decompte?.abstentions),
    votedAt: new Date(value.dateScrutin).toISOString(),
    sourceUrl,
    sourceUpdatedAt,
    sourceHash: stableHash(value),
  };
  const amendment = amendmentNumber ? {
    officialId: `${value.uid}:amendment:${amendmentNumber}`,
    dossierId: dossier.id,
    chamber: "AN" as const,
    number: amendmentNumber,
    authorName: title.match(/(?:de|du|des)\s+(M(?:me)?\.?\s+[^à]+?)\s+à\s+/i)?.[1]?.trim() ?? null,
    subject: title,
    outcomeCode: outcome(String(value.sort?.libelle ?? value.sort?.code ?? "")),
    outcomeLabel: String(value.sort?.libelle ?? "En attente"),
    votedAt: scrutin.votedAt,
    sourceUrl,
    sourceUpdatedAt,
    sourceHash: stableHash({ title, result: value.sort }),
  } : null;
  return { scrutin, amendment, votes, groupResults };
}
