import { stableHash } from "./normalization.js";

const decode = (value: string) => value === "\\N" ? null : value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const outcomeCode = (label: string) => normalized(label).includes("adopte") ? "adopted"
  : normalized(label).includes("rejete") ? "rejected"
  : normalized(label).includes("retire") ? "withdrawn"
  : normalized(label).includes("non soutenu") ? "not_defended" : "pending";

export interface AmeliAmendment {
  officialId: string;
  signet: string;
  number: string;
  authorName: string | null;
  body: string | null;
  subject: string | null;
  outcomeCode: string;
  outcomeLabel: string;
  depositedAt: string;
  sourceHash: string;
}

export async function parseAmeliDump(lines: AsyncIterable<string>, since = "2024-07-01"): Promise<AmeliAmendment[]> {
  const amendments = new Map<string, { txtId: string; number: string; body: string | null; subject: string | null; depositedAt: string; sorId: string | null }>();
  const authors = new Map<string, string[]>();
  const outcomes = new Map<string, string>();
  const texts = new Map<string, string>();
  let table: string | null = null;
  for await (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    const copy = line.match(/^COPY\s+(amd|amdsen|sor|txt_ameli)\s+/);
    if (copy) { table = copy[1]; continue; }
    if (line === "\\.") { table = null; continue; }
    if (!table || !line) continue;
    const fields = line.split("\t").map(decode);
    if (table === "amd" && fields[0] && fields[10] && fields[20] && fields[20] >= since) {
      amendments.set(fields[0], { txtId: fields[10], number: fields[15] ?? "", body: fields[18], subject: fields[19], depositedAt: fields[20], sorId: fields[6] });
    } else if (table === "amdsen" && fields[0] && amendments.has(fields[0])) {
      const name = [fields[3], fields[5], fields[4]].filter(Boolean).join(" ").trim();
      authors.set(fields[0], [...(authors.get(fields[0]) ?? []), name]);
    } else if (table === "sor" && fields[0] && fields[1]) {
      outcomes.set(fields[0], fields[1]);
    } else if (table === "txt_ameli" && fields[0] && fields[23]) {
      texts.set(fields[0], fields[23]);
    }
  }
  return [...amendments.entries()].flatMap(([id, amendment]) => {
    const signet = texts.get(amendment.txtId);
    if (!signet) return [];
    const outcomeLabel = amendment.sorId ? outcomes.get(amendment.sorId) ?? "En attente" : "En attente";
    const record = {
      officialId: `SENAT:AMELI:${id}`,
      signet,
      number: amendment.number,
      authorName: authors.get(id)?.filter(Boolean).join(", ") || null,
      body: amendment.body,
      subject: amendment.subject,
      outcomeCode: outcomeCode(outcomeLabel),
      outcomeLabel,
      depositedAt: new Date(amendment.depositedAt.replace(" ", "T") + "Z").toISOString(),
    };
    return [{ ...record, sourceHash: stableHash(record) }];
  });
}
