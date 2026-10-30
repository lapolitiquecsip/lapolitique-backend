import { randomUUID } from "node:crypto";
import { disponible, noter } from "./budget-claude.js";

/**
 * Agentik (agentik.cc) : passerelle vers des outils payants à l'appel, sans marge sur le prix
 * du fournisseur (30/10/2026) — profils de réseaux sociaux (ScrapeCreators), lecture de pages
 * qui bloquent nos robots (Firecrawl), transcriptions de vidéos.
 *
 *   POST https://api.agentik.cc/v1/run   { tool_id, input }   Authorization: Bearer <clé>
 *
 * Garde-fous : le solde est prépayé (pas de recharge automatique) ; chaque appel réserve son
 * maximum puis règle la consommation réelle. Ici, trois protections de plus :
 *   1. budget : la part « agentik » du plafond mensuel (budget-claude.ts), dépenses inscrites
 *      dans ia_depenses ; au-delà, l'appel n'est pas fait ;
 *   2. un `maxUsd` par appel (refusé si le prix annoncé le dépasse) ;
 *   3. la clé elle-même est plafonnée côté Agentik (à régler dans le compte : 0,50 $ par jour).
 * Sans clé AGENTIK_API_KEY, tout appel renvoie `{ ok: false, raison: "pas de clé" }` : les
 * tâches qui s'en servent gardent alors leur méthode actuelle.
 */
const BASE = "https://api.agentik.cc/v1";

export type ResultatAgentik = { ok: true; sortie: any; usd: number; run: string | null } | { ok: false; raison: string; usd: number };

export const agentikActif = () => !!process.env.AGENTIK_API_KEY;

async function appeler(chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
  const r = await fetch(`${BASE}${chemin}`, {
    method: corps === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${process.env.AGENTIK_API_KEY}`, "Content-Type": "application/json", ...entetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
    signal: AbortSignal.timeout(60_000),
  });
  const texte = await r.text();
  let json: any = null; try { json = JSON.parse(texte); } catch { /* corps non JSON : gardé en texte */ }
  return { statut: r.status, json, texte };
}

/** Prix annoncé d'un outil (dollars, maximum d'un appel), d'après l'inspection publique. */
export async function prixMax(outil: string): Promise<number | null> {
  const { statut, json } = await appeler(`/tools/${outil}`);
  if (statut !== 200) return null;
  const p = json?.pricing || json?.tool?.pricing;
  if (!p) return null;
  const v = p.amountUsd ?? p.maxUsdDefault;
  return typeof v === "number" ? v : null;
}

/**
 * Lance un outil. `poste` n'a qu'une valeur ici (« agentik ») mais le journal garde l'outil
 * dans `detail`. `maxUsd` : prix maximum accepté pour CET appel.
 */
export async function executer(outil: string, input: Record<string, unknown>, { maxUsd = 0.05 } = {}): Promise<ResultatAgentik> {
  if (!agentikActif()) return { ok: false, raison: "pas de clé", usd: 0 };
  if ((await disponible("agentik")) < maxUsd) return { ok: false, raison: "budget Agentik du jour épuisé", usd: 0 };
  const cle = randomUUID();   // une exécution voulue = une clé ; un nouvel essai réseau réutilise la même
  let r = await appeler("/run", { tool_id: outil, input }, { "Idempotency-Key": cle }).catch(() => null);
  if (!r) r = await appeler("/run", { tool_id: outil, input }, { "Idempotency-Key": cle }).catch(() => null);
  if (!r) return { ok: false, raison: "réseau", usd: 0 };
  // Réponse : { ok, run_id, status, price_billed_usd, output, … } (relevé sur un vrai appel, 30/10/2026).
  const usd = Number(r.json?.price_billed_usd ?? 0) || 0;
  if (usd > 0) await noter("agentik", "agentik", usd, outil);
  if (r.statut >= 200 && r.statut < 300 && r.json?.ok !== false && r.json?.status === "COMPLETED") return { ok: true, sortie: r.json.output, usd, run: r.json.run_id ?? null };
  return { ok: false, raison: `HTTP ${r.statut} ${String(r.json?.error?.message ?? r.json?.status ?? r.texte).slice(0, 160)}`, usd };
}

/** Page web en texte Markdown (Firecrawl, 0,0025 $), pour les sites qui bloquent nos serveurs. */
export async function lirePageAgentik(url: string): Promise<string | null> {
  const r = await executer("firecrawl/scrape", { url, onlyMainContent: true });
  if (r.ok === false) { if (r.raison !== "pas de clé") console.log(`[Agentik] lecture de ${url} : ${r.raison}`); return null; }
  const texte = r.sortie?.markdown;
  return typeof texte === "string" && texte.trim() ? texte : null;
}

/** Sous-titres d'une vidéo YouTube (ScrapeCreators, 0,00188 $), quand yt-dlp n'y arrive pas. */
export async function transcriptionAgentik(url: string): Promise<string> {
  const r = await executer("scrapecreators/get-v1-youtube-video-transcript", { url, language: "fr" });
  if (r.ok === false) { if (r.raison !== "pas de clé") console.log(`[Agentik] transcription de ${url} : ${r.raison}`); return ""; }
  const texte = r.sortie?.transcript_only_text;
  return typeof texte === "string" ? texte.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim() : "";
}
