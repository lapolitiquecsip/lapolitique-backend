import crypto from "crypto";
import { supabase } from "../config/supabase.js";

/**
 * Le fait d'origine d'une alerte de parti ou de candidat, tel que le tri éditorial l'a noté
 * (tri_suivis.evenement, generate-suivis-notifications.ts) : deux journaux qui racontent le même
 * fait en deux titres différents y ont la même phrase. Sert aux e-mails à ne le donner qu'une fois.
 * Lecture seule, sans IA.
 */
const cle = (s: string) => crypto.createHash("md5").update(s).digest("hex").slice(0, 16);

export async function faitsDesAlertes(notifs: { id: string | number; type?: string | null; dedup_key?: string | null; url?: string | null; title?: string | null }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const parCle = new Map<string, string[]>();
  for (const n of notifs) {
    const k = String(n.dedup_key || "");
    // Ligne « fait commenté par N articles » : son titre EST le fait.
    if (k.startsWith("evt|")) { out.set(String(n.id), String(n.title || "")); continue; }
    const m = k.match(/^suivi\|(parti|candidat)\|([^|]+)\|/);
    if (!m) continue;
    const titre = String(n.title || "");
    // La clé du tri porte le lien, ou le titre d'origine (dont l'alerte a mis la 1re lettre en capitale).
    for (const source of [n.url, titre, titre.charAt(0).toLowerCase() + titre.slice(1)].filter(Boolean) as string[]) {
      const c = cle(`${m[1]}|${m[2]}|${source}`);
      parCle.set(c, [...(parCle.get(c) || []), String(n.id)]);
    }
  }
  const cles = [...parCle.keys()];
  for (let i = 0; i < cles.length; i += 200) {
    const { data } = await supabase.from("tri_suivis").select("cle, evenement").in("cle", cles.slice(i, i + 200)).not("evenement", "is", null);
    for (const t of data || []) for (const id of parCle.get(t.cle) || []) if (!out.has(id)) out.set(id, t.evenement);
  }
  return out;
}
