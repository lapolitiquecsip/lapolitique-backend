import { stableHash } from "./normalization.js";

const decode = (value: string) => value === "\\N" ? null : value.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
const integer = (value: string | null | undefined) => Number.parseInt(value ?? "0", 10) || 0;
const key = (session: string | null, number: string | null) => `${session}:${number}`;

export async function parseDoslegDump(lines: AsyncIterable<string>, since = "2024-07-01") {
  const senators = new Map<string, { name: string; groupCode: string | null }>();
  const positions = new Map<string, string>();
  const scrutins = new Map<string, any>();
  const urls = new Map<string, string>();
  const votes: Array<{ key: string; senatorId: string; positionCode: string }> = [];
  let table: string | null = null;
  for await (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    const copy = line.match(/^COPY\s+(auteur|posvot|scr|corscr|votsen)\s+/);
    if (copy) { table = copy[1]; continue; }
    if (line === "\\.") { table = null; continue; }
    if (!table || !line) continue;
    const fields = line.split("\t").map(decode);
    if (table === "auteur" && fields[6]) senators.set(fields[6], { name: [fields[4], fields[3]].filter(Boolean).join(" "), groupCode: fields[7] });
    else if (table === "posvot" && fields[0] && fields[1]) positions.set(fields[0], fields[1]);
    else if (table === "scr" && fields[0] && fields[1] && fields[4] && fields[4] >= since) {
      const voterCount = integer(fields[7]); const expressed = integer(fields[8]);
      scrutins.set(key(fields[0], fields[1]), { session: fields[0], number: fields[1], title: fields[3] ?? "Scrutin public", votedAt: fields[4], forCount: integer(fields[5]), againstCount: integer(fields[6]), abstainCount: Math.max(0, voterCount - expressed), resultLabel: fields[15] ?? "" });
    } else if (table === "corscr" && fields[0] && fields[1] && fields[4]) urls.set(key(fields[0], fields[1]), fields[4]);
    else if (table === "votsen" && fields[0] && fields[1] && fields[2] && fields[3]) votes.push({ key: key(fields[0], fields[1]), senatorId: fields[2], positionCode: fields[3] });
  }
  const mapPosition = (code: string) => {
    const label = (positions.get(code) ?? code).toLowerCase();
    if (label.includes("pour")) return "for";
    if (label.includes("contre")) return "against";
    if (label.includes("abst")) return "abstain";
    return "non_voting";
  };
  return [...scrutins.entries()].map(([scrutinKey, scrutin]) => {
    const scrutinVotes = votes.filter(vote => vote.key === scrutinKey).map(vote => ({ voterOfficialId: vote.senatorId, voterName: senators.get(vote.senatorId)?.name ?? vote.senatorId, groupCode: senators.get(vote.senatorId)?.groupCode ?? null, position: mapPosition(vote.positionCode) }));
    const groups = new Map<string, { groupCode: string; forCount: number; againstCount: number; abstainCount: number; nonVotingCount: number }>();
    for (const vote of scrutinVotes) {
      if (!vote.groupCode) continue;
      const group = groups.get(vote.groupCode) ?? { groupCode: vote.groupCode, forCount: 0, againstCount: 0, abstainCount: 0, nonVotingCount: 0 };
      if (vote.position === "for") group.forCount++; else if (vote.position === "against") group.againstCount++; else if (vote.position === "abstain") group.abstainCount++; else group.nonVotingCount++;
      groups.set(vote.groupCode, group);
    }
    const record = { officialId: `SENAT:DOSLEG:${scrutin.session}:${scrutin.number}`, ...scrutin, sourceUrl: urls.get(scrutinKey) ?? "https://www.senat.fr/scrutin-public/", votes: scrutinVotes, groupResults: [...groups.values()] };
    return { ...record, sourceHash: stableHash(record) };
  });
}
