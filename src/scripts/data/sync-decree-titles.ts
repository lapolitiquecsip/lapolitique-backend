import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Titre synthétisé des décrets : à la place de « Décret n° 2026-697 du 28 juillet 2026 relatif à
// la dématérialisation des certificats de décès », on affiche directement le SUJET
// (« Dématérialisation des certificats de décès »). Règle rapide pour Nomination/Distinction ;
// DeepSeek (heures creuses) pour le Réglementaire. Idempotent : ne traite que display_title vide.
function stripPrefix(t: string): string {
  let s = (t || "")
    .replace(/^Décret(\s+n°?\s*[\d-]+)?\s+du\s+\d{1,2}\s+[A-Za-zà-ÿ]+\s+\d{4}\s+/iu, "")
    .replace(/^(portant\s+(sur\s+)?|relati(f|ve)s?\s+(à l'|à la|à|au|aux)\s+|fixant\s+|modifiant\s+|autorisant\s+|approuvant\s+|instituant\s+|créant\s+|abrogeant\s+)/i, "")
    .replace(/\s+/g, " ").trim();
  if (!s) return t;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function aiTitle(title: string): Promise<string | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 40,
    system: `On te donne le TITRE OFFICIEL d'un décret publié au Journal officiel. Renvoie UNIQUEMENT son SUJET, en 3 à 8 mots, en français clair. Interdits : « Décret », le numéro, la date, « portant/relatif à/fixant ». Commence par une majuscule, sans point final. Exemple : « Décret n° 2026-697 du 28 juillet 2026 relatif à la dématérialisation des certificats de décès » → « Dématérialisation des certificats de décès ».`,
    messages: [{ role: "user", content: `TITRE : ${title}` }],
  }, { timeoutMs: 45000 });
  let t = resp.content?.[0]?.text?.trim() || "";
  t = t.replace(/^["'«»\s]+|["'«».\s]+$/g, "");
  return t.length >= 3 && t.length <= 90 ? t : null;
}

async function main() {
  const limit = Number((process.argv.find(a => a.startsWith("--limit="))?.split("=")[1]) || 0);
  console.log("--- TITRES SYNTHÉTISÉS DES DÉCRETS ---");
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("decrees")
      .select("jorf_id, title, decree_type").is("display_title", null).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`> ${rows.length} décrets sans titre synthétisé.`);

  let ok = 0, ai = 0;
  for (const d of rows) {
    if (limit && ok >= limit) break;
    let title: string | null = null;
    if (d.decree_type === "Nomination" || d.decree_type === "Distinction") {
      title = stripPrefix(d.title);                       // règle gratuite
    } else {
      try { title = await aiTitle(d.title); ai++; } catch (e: any) { console.error(`  IA ${d.jorf_id}: ${e.message}`); }
      if (!title) title = stripPrefix(d.title);           // repli si l'IA échoue
    }
    if (!title) continue;
    const { error: upErr } = await supabase.from("decrees").update({ display_title: title }).eq("jorf_id", d.jorf_id);
    if (upErr) { console.error(`  update ${d.jorf_id}: ${upErr.message}`); continue; }
    ok++;
    if (ok % 50 === 0) console.log(`  … ${ok}`);
  }
  console.log(`--- TERMINE. ${ok} titres (${ai} via IA). ---`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
