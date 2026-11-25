import { supabase } from "../config/supabase.js";

/**
 * Accès au compte Instagram @lapolitique_cest_simple, partagé par la publication et les statistiques.
 *
 * Deux sortes de jeton sont acceptées (table jetons_reseaux d'abord, sinon secret INSTAGRAM_ACCESS_TOKEN) :
 * - « EAA… » : jeton d'utilisateur système de l'app Meta AUTOMATION (25/11/2026), PERMANENT, qui passe
 *   par graph.facebook.com. Rien à renouveler.
 * - « IG… » : jeton « connexion Instagram » de 60 jours, sur graph.instagram.com, renouvelé ici chaque
 *   semaine et rangé dans jetons_reseaux.
 * Les chemins d'API (/{compte}/media, /media_publish, /insights…) sont les mêmes sur les deux hôtes.
 */
export type Instagram = { jeton: string; compte: string; base: string; pseudo: string };

const VERSION = "v23.0";
const COMPTE_PAR_DEFAUT = "17841472097024685";
let memo: Instagram | null = null;

export async function lireJson(r: Response, quoi: string) {
  const t = await r.text();
  // Jamais le jeton dans un message d'erreur ou un journal GitHub.
  if (!r.ok) throw new Error(`${quoi} ${r.status} : ${t.replace(/access_token=[^&"\s]+/g, "access_token=…").slice(0, 400)}`);
  return t ? JSON.parse(t) : {};
}

export async function instagram(): Promise<Instagram | null> {
  if (memo) return memo;
  const { data: rangee } = await supabase.from("jetons_reseaux").select("jeton, maj_le").eq("plateforme", "instagram").maybeSingle();
  const secret = process.env.INSTAGRAM_ACCESS_TOKEN;
  let jeton: string | undefined = rangee?.jeton ?? secret;
  if (!jeton) return null;
  let maj = rangee?.maj_le ? new Date(rangee.maj_le).getTime() : 0;
  const hote = (j: string) => (j.startsWith("EAA") ? `https://graph.facebook.com/${VERSION}` : `https://graph.instagram.com/${VERSION}`);
  const essayer = async (j: string) => {
    const base = hote(j);
    if (j.startsWith("EAA")) {
      const id = process.env.INSTAGRAM_USER_ID || COMPTE_PAR_DEFAUT;
      const c = await fetch(`${base}/${id}?fields=id,username&access_token=${j}`).then(r => lireJson(r, "Instagram compte"));
      return { compte: String(c.id), pseudo: c.username as string };
    }
    const c = await fetch(`${base}/me?fields=user_id,username&access_token=${j}`).then(r => lireJson(r, "Instagram compte"));
    return { compte: process.env.INSTAGRAM_USER_ID || String(c.user_id ?? c.id), pseudo: c.username as string };
  };
  let moi: { compte: string; pseudo: string };
  try { moi = await essayer(jeton); } catch (e) {
    // Jeton de la table mort mais secret remplacé à la main depuis : on repart du secret.
    if (!secret || jeton === secret) throw e;
    jeton = secret; maj = 0; moi = await essayer(jeton);
  }
  if (!jeton.startsWith("EAA") && Date.now() - maj > 7 * 86400_000) {
    try {
      const n = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${jeton}`).then(r => lireJson(r, "Instagram renouvellement"));
      jeton = n.access_token as string;
      const { error } = await supabase.from("jetons_reseaux").upsert({ plateforme: "instagram", jeton, compte: moi.pseudo, expire_le: new Date(Date.now() + n.expires_in * 1000).toISOString(), maj_le: new Date().toISOString() });
      if (error) console.log(`::warning::Jeton Instagram renouvelé mais pas rangé : ${error.message}`);
      else console.log(`Jeton Instagram renouvelé (expire dans ${Math.round(n.expires_in / 86400)} jours).`);
    } catch (e) {
      // Un jeton de moins de 24 h refuse le renouvellement : sans gravité, on réessaiera.
      console.log(`::notice::${(e as Error).message}`);
    }
  }
  memo = { jeton: jeton!, compte: moi.compte, base: hote(jeton!), pseudo: moi.pseudo };
  return memo;
}

/** GET sur l'API Graph du compte (chemin relatif, paramètres en clair). */
export async function igGet(chemin: string, params: Record<string, string | number> = {}) {
  const ig = await instagram();
  if (!ig) throw new Error("Aucun jeton Instagram");
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), access_token: ig.jeton });
  return lireJson(await fetch(`${ig.base}/${chemin.replace(/^\//, "")}?${q}`), `Instagram ${chemin.split("?")[0]}`);
}
