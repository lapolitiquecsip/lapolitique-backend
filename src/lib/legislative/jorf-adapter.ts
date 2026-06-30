import { XMLParser } from "fast-xml-parser";
import type { JorfRecord } from "./normalization.js";

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

export function parseJorfXml(xml: string): (JorfRecord & { jorfId: string }) | null {
  const text = parser.parse(xml)?.TEXTE;
  if (!text || String(text.NATURE).toUpperCase() !== "LOI") return null;
  const jorfId = String(text.ID ?? "").trim();
  const nor = String(text.NOR ?? "").trim();
  const title = String(text.TITREFULL ?? text.TITRE ?? "").trim();
  const publishedAt = String(text.DATE_PUBLI ?? "").trim();
  if (!jorfId || !nor || !title || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) return null;
  const eli = typeof text.ID_ELI === "string" ? text.ID_ELI : null;
  return { jorfId, nature: "LOI", nor, title, publishedAt, sourceUrl: eli || `https://www.legifrance.gouv.fr/jorf/id/${jorfId}`, eli };
}
