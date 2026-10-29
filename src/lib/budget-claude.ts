import { supabase } from "../config/supabase.js";

/**
 * Budget de l'API Claude : 20 $ par MOIS au plus, tous usages confondus (29/10/2026 — l'éditeur
 * est étudiant ; ne jamais relever ce plafond sans son accord).
 *
 * Chaque poste a sa part du mois. Chaque jour, il peut dépenser ce qui reste de sa part divisé
 * par le nombre de jours restants : un jour calme laisse davantage aux jours chargés, et le
 * mois ne peut pas dépasser la part. Les dépenses réelles (jetons facturés, calculés sur
 * l'usage renvoyé par l'API) sont inscrites dans la table ia_depenses. Si ce journal est
 * illisible, rien n'est dépensé : mieux vaut un jour sans IA qu'une facture inattendue.
 *
 * Filet de sécurité supplémentaire, côté Anthropic : limite de dépense mensuelle de la console.
 */
export const BUDGET_MOIS = Number(process.env.CLAUDE_BUDGET_MOIS || 20);
export const PARTS = { executif: 0.42, digest: 0.53, programmes: 0.05 } as const;   // 8,40 $ · 10,60 $ · 1 $
export type Poste = keyof typeof PARTS;

/** Tarifs ($ par million de jetons, entrée / sortie). */
export const PRIX: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5],
};

/** Coût réel d'un appel, d'après l'usage renvoyé par l'API. `lot` : API Batches, moitié prix. */
export function coutUsage(modele: string, u: any, { lot = false } = {}): number {
  const [e, s] = PRIX[modele] || PRIX["claude-opus-5-5"];
  const jetons = ((u?.input_tokens || 0) * e + (u?.cache_creation_input_tokens || 0) * e * 1.25
    + (u?.cache_read_input_tokens || 0) * e * 0.1 + (u?.output_tokens || 0) * s) / 1e6;
  return jetons * (lot ? 0.5 : 1) + (u?.server_tool_use?.web_search_requests || 0) * 0.01;
}

const paris = (d = new Date()) => new Date(d.toLocaleString("en-US", { timeZone: "Europe/Paris" }));

/** Ce que le poste peut encore dépenser aujourd'hui (dollars). 0 si le journal est illisible. */
export async function disponible(poste: Poste): Promise<number> {
  const p = paris();
  const debutMois = new Date(Date.UTC(p.getFullYear(), p.getMonth(), 1) - 2 * 36e5);   // marge de fuseau : quelques centimes du mois précédent au pire
  const { data, error } = await supabase.from("ia_depenses").select("poste, usd, cree_le").gte("cree_le", debutMois.toISOString()).limit(20000);
  if (error) { console.log(`::warning::[Budget Claude] journal ia_depenses illisible (${error.message}) : aucune dépense.`); return 0; }
  const duMois = (data || []).filter((r: any) => paris(new Date(r.cree_le)).getMonth() === p.getMonth());
  const total = duMois.reduce((t: number, r: any) => t + Number(r.usd || 0), 0);
  const lignes = duMois.filter((r: any) => r.poste === poste);
  const jour = (r: any) => paris(new Date(r.cree_le)).getDate() === p.getDate();
  const avant = lignes.filter((r: any) => !jour(r)).reduce((t: number, r: any) => t + Number(r.usd || 0), 0);
  const aujourdhui = lignes.filter(jour).reduce((t: number, r: any) => t + Number(r.usd || 0), 0);
  const part = BUDGET_MOIS * PARTS[poste];
  const joursRestants = new Date(p.getFullYear(), p.getMonth() + 1, 0).getDate() - p.getDate() + 1;
  const duJour = Math.max(0, (part - avant) / joursRestants - aujourdhui);
  // Pas plus du double d'une journée ordinaire, même en fin de mois avec un reste : la dépense
  // reste régulière. Et jamais au-delà de la part du mois, ni du plafond global.
  const plafondJour = 2 * part / new Date(p.getFullYear(), p.getMonth() + 1, 0).getDate() - aujourdhui;
  return Math.max(0, Math.min(duJour, plafondJour, part - avant - aujourdhui, BUDGET_MOIS - total));
}

/** Inscrit une dépense réelle. */
export async function noter(poste: Poste, modele: string, usd: number, detail = ""): Promise<void> {
  if (!(usd > 0)) return;
  const { error } = await supabase.from("ia_depenses").insert({ poste, modele, usd: Number(usd.toFixed(5)), detail: detail.slice(0, 200) || null });
  if (error) console.log(`::warning::[Budget Claude] dépense non inscrite (${error.message}) : ${usd.toFixed(4)} $ ${poste}.`);
}
