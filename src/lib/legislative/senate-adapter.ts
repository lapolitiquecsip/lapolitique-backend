import { XMLParser } from "fast-xml-parser";
import { classifyLegislativeText, stableHash } from "./normalization.js";

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true });
const array = <T>(value: T | T[] | null | undefined): T[] => value == null ? [] : Array.isArray(value) ? value : [value];

export function parseSenateText(xml: string, sourceUpdatedAt: string) {
  const root = parser.parse(xml)?.akomaNtoso;
  const bill = root?.bill;
  if (!bill) return null;
  const work = bill.meta?.identification?.FRBRWork;
  const aliases = array(work?.FRBRalias);
  const valueFor = (name: string) => (aliases as any[]).find(alias => alias?.["@_name"] === name)?.["@_value"];
  const signet = valueFor("signet-dossier-legislatif-senat");
  const sourceUrl = valueFor("url-senat");
  const title = String(bill.preamble?.docTitle ?? "").trim();
  if (!signet || !sourceUrl || !title) return null;
  const authorRef = String(work?.FRBRauthor?.["@_href"] ?? "").replace(/^#/, "");
  const people = array(bill.meta?.references?.TLCPerson) as any[];
  const authorName = people.find(person => person?.["@_eId"] === authorRef)?.["@_showAs"] ?? null;
  const steps = (array(bill.meta?.workflow?.step) as any[]).map((step, sequence) => ({
    officialId: `SENAT:${signet}:${step["@_eId"] ?? sequence}`,
    code: String(step["@_refersTo"] ?? "senate_step").replace(/^#/, ""),
    label: String(step["@_outcome"] ?? "Étape au Sénat"),
    chamber: String(step["@_by"] ?? "").includes("assemblee") ? "AN" as const
      : String(step["@_by"] ?? "").includes("cmp") ? "CMP" as const : "SENAT" as const,
    occurredAt: step["@_date"] ? new Date(`${step["@_date"]}T12:00:00Z`).toISOString() : null,
    sequence,
    sourceUrl,
    sourceHash: stableHash(step),
  }));
  const latest = steps.filter(step => step.occurredAt).at(-1) ?? steps.at(-1);
  const isBill = String(bill["@_name"] ?? signet).startsWith("pjl");
  return {
    officialId: `SENAT:${signet}`,
    title,
    textType: isBill ? "bill" as const : "proposal" as const,
    authorKind: isBill ? "government" as const : "parliamentarian" as const,
    authorName: isBill ? "Le Gouvernement" : authorName,
    category: classifyLegislativeText(title),
    statusCode: latest?.label.toLowerCase().includes("adopt") ? "voted" : "filed",
    statusLabel: latest?.label ?? "Déposé au Sénat",
    currentChamber: "SENAT" as const,
    depositedAt: steps[0]?.occurredAt?.slice(0, 10) ?? null,
    latestStepAt: latest?.occurredAt ?? null,
    sourceUrls: [sourceUrl],
    sourceUpdatedAt,
    sourceHash: stableHash({ signet, title, authorName, steps }),
    steps,
  };
}
