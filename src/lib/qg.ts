import { supabase } from "../config/supabase.js";

/**
 * Le QG des agents (24/11/2026) — ce que tout agent appelle pour rendre des comptes.
 *
 * Règle d'or : un agent ne fait RIEN d'extérieur (publier, envoyer, fusionner, dépenser) sans
 * une demande au statut « validee ». Il dépose la demande (`demander`), passe son chemin, et au
 * passage suivant relit ses demandes validées (`aExecuter`), relit le statut juste avant d'agir
 * (`encoreValidee`), agit, puis écrit le résultat (`executee` / `echec`).
 *
 * Le co-CEO (fonction Edge `qg`, dépôt du site) envoie chaque demande sur WhatsApp avec les
 * boutons Valider · Refuser · Modifier ; « Modifier » revient au statut « a_modifier » avec la
 * consigne d'Hippolyte dans `commentaire` : l'agent refait son brouillon et redemande.
 */

export type Equipe = "direction" | "marketing" | "prospection" | "developpement" | "production";
export type Societe = "lpcs" | "daedalus";

export type Demande = {
  id: string; societe: Societe; equipe: Equipe; agent: string; action: string; titre: string; resume: string | null;
  apercu: Record<string, unknown>; statut: string; commentaire: string | null; cle: string | null; cree_le: string;
};

/**
 * Dépose une demande de validation. `cle` évite les doublons : la même clé ne crée jamais deux
 * demandes (l'existante est renvoyée). `apercu` = ce qui partira EXACTEMENT (texte, image, lien,
 * destinataire), c'est ce qu'Hippolyte valide.
 */
export async function demander(d: {
  agent: string; equipe: Equipe; action: string; titre: string; resume?: string; societe?: Societe;
  apercu?: { texte?: string; image?: string; lien?: string; destinataire?: string; [k: string]: unknown };
  risque?: "faible" | "normal" | "eleve"; cout_estime?: number; urgence?: boolean; cle?: string; expire_dans_heures?: number;
}): Promise<Demande | null> {
  if (d.cle) {
    const { data: deja } = await supabase.from("qg_demandes").select("*").eq("cle", d.cle).maybeSingle();
    if (deja) return deja as Demande;
  }
  const { data, error } = await supabase.from("qg_demandes").insert({
    agent: d.agent, equipe: d.equipe, action: d.action, titre: d.titre, resume: d.resume ?? null,
    societe: d.societe ?? "lpcs", apercu: d.apercu ?? {}, risque: d.risque ?? "normal",
    cout_estime: d.cout_estime ?? null, urgence: d.urgence ?? false, cle: d.cle ?? null,
    expire_le: d.expire_dans_heures ? new Date(Date.now() + d.expire_dans_heures * 3600e3).toISOString() : null,
  }).select("*").single();
  if (error) { console.warn(`[QG] demande non déposée (${d.titre}) : ${error.message}`); return null; }
  await noter({ agent: d.agent, equipe: d.equipe, societe: d.societe, message: `Demande de validation : ${d.titre}`, demande: data.id });
  return data as Demande;
}

/** Les demandes validées de cet agent, pas encore exécutées ni expirées. */
export async function aExecuter(agent: string, action?: string): Promise<Demande[]> {
  let q = supabase.from("qg_demandes").select("*").eq("agent", agent).eq("statut", "validee").order("decide_le");
  if (action) q = q.eq("action", action);
  const { data } = await q;
  const maintenant = Date.now();
  return ((data ?? []) as any[]).filter(d => !d.expire_le || Date.parse(d.expire_le) > maintenant);
}

/** Les demandes renvoyées par Hippolyte avec une consigne (« Modifier »). */
export async function aRevoir(agent: string): Promise<Demande[]> {
  const { data } = await supabase.from("qg_demandes").select("*").eq("agent", agent).eq("statut", "a_modifier").order("decide_le");
  return (data ?? []) as Demande[];
}

/** À relire juste avant d'agir : une décision a pu changer entre-temps. */
export async function encoreValidee(id: string): Promise<boolean> {
  const { data } = await supabase.from("qg_demandes").select("statut, expire_le").eq("id", id).maybeSingle();
  return data?.statut === "validee" && (!data.expire_le || Date.parse(data.expire_le) > Date.now());
}

export async function executee(d: Pick<Demande, "id" | "agent" | "equipe" | "titre"> & { societe?: Societe }, resultat: Record<string, unknown> = {}) {
  await supabase.from("qg_demandes").update({ statut: "executee", execute_le: new Date().toISOString(), resultat }).eq("id", d.id);
  await noter({ agent: d.agent, equipe: d.equipe, societe: d.societe, genre: "succes", message: `Fait : ${d.titre}`, lien: typeof resultat.lien === "string" ? resultat.lien : undefined, demande: d.id });
}

export async function echec(d: Pick<Demande, "id" | "agent" | "equipe" | "titre"> & { societe?: Societe }, erreur: string) {
  await supabase.from("qg_demandes").update({ statut: "echec", execute_le: new Date().toISOString(), resultat: { erreur } }).eq("id", d.id);
  await noter({ agent: d.agent, equipe: d.equipe, societe: d.societe, genre: "panne", message: `Échec : ${d.titre} — ${erreur}`, demande: d.id });
}

/** Une ligne dans le fil d'activité du QG. */
export async function noter(a: {
  agent: string; equipe: Equipe | string; message: string; societe?: Societe;
  genre?: "info" | "succes" | "attention" | "panne" | "decision"; lien?: string; demande?: string;
}) {
  const { error } = await supabase.from("qg_activite").insert({
    agent: a.agent, equipe: a.equipe, societe: a.societe ?? "lpcs", genre: a.genre ?? "info",
    message: a.message.slice(0, 1000), lien: a.lien ?? null, demande: a.demande ?? null,
  });
  if (error) console.warn(`[QG] activité non notée : ${error.message}`);
}

/** Fin de passage d'un agent : son état dans l'organigramme du QG. */
export async function passage(agent: string, etat: "ok" | "attention" | "panne", message?: string) {
  await supabase.from("qg_agents").update({ dernier_passage: new Date().toISOString(), dernier_etat: etat, dernier_message: message ?? null }).eq("id", agent);
}
