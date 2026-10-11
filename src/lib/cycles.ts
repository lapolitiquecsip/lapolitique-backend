import { supabase } from "../config/supabase.js";

/**
 * Cycles d'agents : le passage de relais.
 *
 * Chaque agent ne fait qu'une chose. Il prend les objets arrivés à SON étape, fait son
 * travail, et les pose à l'étape suivante — où un autre agent les prendra. Le relais est la
 * table cycle_items : personne n'appelle personne, chacun lit ce que le précédent a laissé.
 * Un agent en panne n'arrête donc pas les autres, et un objet bloqué reste visible avec son
 * motif au lieu de disparaître.
 *
 * Voir docs/agents-cycles.md.
 */

export type Cycle = "programmes" | "auditions";

export type Item = {
  cycle: Cycle;
  cle: string;
  etape: string;
  sujet: string | null;
  titre: string | null;
  source_url: string | null;
  date_objet: string | null;
  donnees: Record<string, any>;
  tentatives: number;
  erreur: string | null;
  agent: string | null;
  alerte_le: string | null;
  detecte_le: string;
  maj_le: string;
  en_ligne_le: string | null;
};

/** Étapes où l'objet a fini sa course : plus aucun agent n'y touche. */
export const TERMINALES = new Set(["en_ligne", "ecarte", "sans_source"]);

const maintenant = () => new Date().toISOString();

/** Tous les objets d'un cycle, indexés par clé. */
export async function lireCycle(cycle: Cycle): Promise<Map<string, Item>> {
  const tout: Item[] = [];
  for (let debut = 0; ; debut += 1000) {
    const { data, error } = await supabase.from("cycle_items").select("*")
      .eq("cycle", cycle).range(debut, debut + 999);
    if (error) throw new Error(`cycle_items : ${error.message}`);
    tout.push(...((data ?? []) as Item[]));
    if (!data || data.length < 1000) break;
  }
  return new Map(tout.map(i => [i.cle, i]));
}

/** Les objets qui attendent à une étape donnée, du plus ancien au plus récent. */
export async function enAttente(cycle: Cycle, etape: string, limite = 20): Promise<Item[]> {
  const { data, error } = await supabase.from("cycle_items").select("*")
    .eq("cycle", cycle).eq("etape", etape).order("detecte_le", { ascending: true }).limit(limite);
  if (error) throw new Error(`cycle_items : ${error.message}`);
  return (data ?? []) as Item[];
}

/**
 * Signale un objet, ou met à jour son état s'il est déjà suivi.
 *
 * `detecte_le` n'est jamais réécrit : c'est lui qui mesure depuis combien de temps un objet
 * attend. Les données sont fusionnées, pas remplacées — chaque agent ajoute sa part.
 */
export async function signaler(
  agent: string,
  connu: Item | undefined,
  item: Pick<Item, "cycle" | "cle" | "etape"> & Partial<Item>,
): Promise<"nouveau" | "avance" | "inchange"> {
  const { donnees, ...reste } = item;
  if (!connu) {
    const { error } = await supabase.from("cycle_items").insert({
      ...reste, donnees: donnees ?? {}, agent, maj_le: maintenant(),
      en_ligne_le: item.etape === "en_ligne" ? maintenant() : null,
    });
    if (error) throw new Error(`cycle_items (insertion ${item.cle}) : ${error.message}`);
    return "nouveau";
  }
  const fusion = { ...connu.donnees, ...(donnees ?? {}) };
  const change = connu.etape !== item.etape
    || (item.erreur !== undefined && (item.erreur ?? null) !== connu.erreur)
    || JSON.stringify(fusion) !== JSON.stringify(connu.donnees);
  if (!change) return "inchange";
  const { error } = await supabase.from("cycle_items").update({
    ...reste, donnees: fusion, agent, maj_le: maintenant(),
    // Un objet qui avance repart sans erreur ni alerte : le blocage est levé.
    ...(connu.etape !== item.etape ? { erreur: item.erreur ?? null, alerte_le: null } : {}),
    ...(item.etape === "en_ligne" && !connu.en_ligne_le ? { en_ligne_le: maintenant() } : {}),
  }).eq("cycle", item.cycle).eq("cle", item.cle);
  if (error) throw new Error(`cycle_items (mise à jour ${item.cle}) : ${error.message}`);
  return connu.etape !== item.etape ? "avance" : "inchange";
}

/** Note un échec sans changer d'étape : l'agent réessaiera au prochain passage. */
export async function echec(agent: string, item: Item, erreur: string): Promise<void> {
  await supabase.from("cycle_items").update({
    tentatives: item.tentatives + 1, erreur: erreur.slice(0, 500), agent, maj_le: maintenant(),
  }).eq("cycle", item.cycle).eq("cle", item.cle);
}

export const sansAccent = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Insère d'un coup des objets jamais vus (premier passage d'un veilleur : plusieurs centaines). */
export async function signalerLot(agent: string, items: (Pick<Item, "cycle" | "cle" | "etape"> & Partial<Item>)[]): Promise<void> {
  for (let i = 0; i < items.length; i += 200) {
    const lot = items.slice(i, i + 200).map(it => ({
      ...it, donnees: it.donnees ?? {}, agent, maj_le: maintenant(),
      en_ligne_le: it.etape === "en_ligne" ? maintenant() : null,
    }));
    const { error } = await supabase.from("cycle_items").upsert(lot, { onConflict: "cycle,cle", ignoreDuplicates: true });
    if (error) throw new Error(`cycle_items (lot) : ${error.message}`);
  }
}
