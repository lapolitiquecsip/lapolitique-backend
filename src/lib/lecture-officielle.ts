import Anthropic from "@anthropic-ai/sdk";
import { coutUsage, disponible, noter } from "./budget-claude.js";

/**
 * Lecture d'une page de site officiel (programme de candidat), avec une voie de secours.
 *
 * Depuis la mi-octobre 2026, le pare-feu de melenchon2027.fr répond « HTTP 403 » aux serveurs
 * de GitHub (où tournent les crons), alors que son robots.txt autorise tous les robots : le
 * plan « Automobile » (15/10) est resté bloqué et le plan « Enseignement supérieur » (26/10)
 * n'a même pas été vu. La lecture directe reste la voie normale (HTML complet, intertitres) ;
 * si elle est refusée, la page est lue par l'outil web_fetch de l'API Claude, qui se présente
 * sous sa propre identité de robot. On récupère alors le TEXTE de la page tel que l'outil l'a
 * lu — jamais une reformulation du modèle (on ne lui demande rien d'autre que d'ouvrir la page).
 * Coût : une lecture par Haiku, environ un centime pour un plan de quarante pages.
 */
const UA = { "User-Agent": "Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)" };
const REFUS = /HTTP (403|429|5\d\d)|fetch failed|timeout|aborted/i;

export type PageLue = { html: string; texte?: undefined; via: "direct" } | { html?: undefined; texte: string; via: "web_fetch" };

/** Erreur réseau ou refus du site : à retenter, et à lire par la voie de secours. */
export const estRefus = (message: string | null | undefined) => REFUS.test(message || "");

export async function lirePageOfficielle(url: string, { secours = true } = {}): Promise<PageLue> {
  let refus: string;
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
    if (r.ok) return { html: await r.text(), via: "direct" };
    refus = `HTTP ${r.status}`;
  } catch (e: any) { refus = e?.message || String(e); }
  if (!secours || !process.env.ANTHROPIC_API_KEY) throw new Error(refus);
  // Part « programmes » des 20 $ mensuels (budget-claude.ts) : 1 $, soit une centaine de pages.
  if (await disponible("programmes") < 0.03) throw new Error(`${refus} ; secours web_fetch : budget Claude du jour épuisé`);

  const msg = await new Anthropic().messages.stream({
    model: "claude-haiku-5-5", max_tokens: 512,
    tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 1, allowed_domains: [new URL(url).hostname], max_content_tokens: 100000 } as any],
    messages: [{ role: "user", content: `Ouvre ${url} avec l'outil web_fetch, puis réponds seulement « lu ».` }],
  }).finalMessage();
  await noter("programmes", "claude-haiku-5-5", coutUsage("claude-haiku-5-5", msg.usage), url);
  for (const b of msg.content as any[]) {
    if (b.type !== "web_fetch_tool_result") continue;
    const c = b.content;
    if (c?.type === "web_fetch_tool_error" || c?.error_code) throw new Error(`${refus} ; secours web_fetch : ${c.error_code}`);
    const data = c?.content?.source?.data;
    if (typeof data === "string" && data.trim()) return { texte: data, via: "web_fetch" };
  }
  throw new Error(`${refus} ; secours web_fetch : page non lue`);
}

/** Adresses citées dans un texte lu par web_fetch (liens Markdown ou adresses en clair). */
export function liensDuTexte(texte: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of texte.matchAll(/\]\(([^)\s]+)\)|https?:\/\/[^\s)"'<>\]]+/g)) {
    try { out.add(new URL(m[1] ?? m[0], base).toString()); } catch { /* lien illisible */ }
  }
  return [...out];
}
