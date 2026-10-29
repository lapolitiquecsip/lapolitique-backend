import "dotenv/config";
import Parser from "rss-parser";
import { supabase } from "../../config/supabase.js";
import { texteDecode } from "../../lib/decodage.js";

/**
 * Répare les accents perdus (« � ») des articles du Sénat, lus en UTF-8 alors que leurs flux
 * sont en iso-8859-15 (corrigé le 30/10/2026, voir lib/decodage.ts).
 *
 * 1. Quand l'article est encore dans un flux du Sénat : titre et description repris tels quels.
 * 2. Sinon, mot par mot : « N� » → « N° » ; « � » seul → « à », ou guillemet quand il suit un
 *    article (« du � code noir � ») ; un mot abîmé (« d�pos� ») prend la forme accentuée la plus
 *    fréquente dans les textes sains du site (titres et résumés rédigés, dossiers, lois).
 *
 * Usage : npx tsx src/scripts/data/reparer-accents.ts [--ecrire]
 */
const ECRIRE = process.argv.includes("--ecrire");
const R = "�";
const CHAMPS = ["titre_original", "titre_simplifie", "resume_flash", "resume_detaille", "raw_text"] as const;
const ACCENTS = "éèêëàâäîïôöùûüçœæÉÈÊÀÂÎÔÛÇ";

async function tout<T>(table: string, cols: string, filtre?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    let q = supabase.from(table).select(cols).range(de, de + 999);
    if (filtre) q = filtre(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} : ${error.message}`);
    out.push(...(data as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const cleUrl = (u: string) => (u || "").replace(/^https?:\/\//, "").replace(/\/{2,}/g, "/").replace(/\/$/, "").toLowerCase();

async function main() {
  // 1. Les flux du Sénat, bien décodés cette fois.
  const flux = new Map<string, { titre: string; description: string }>();
  const parser = new Parser();
  for (const u of ["https://www.senat.fr/rss/textes.rss", "https://www.senat.fr/rss/presse.rss", "https://www.senat.fr/rss/rapports.rss"]) {
    try {
      const f = await parser.parseString(await texteDecode(await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)" } })));
      for (const it of f.items || []) if (it.link) flux.set(cleUrl(it.link), { titre: (it.title || "").trim(), description: (it.contentSnippet || it.content || "").trim() });
    } catch (e: any) { console.log(`  ! flux ${u} : ${e.message}`); }
  }
  console.log(`[Flux] ${flux.size} articles relus dans les flux du Sénat.`);

  // 2. Dictionaire des formes accentuées, tiré des textes sains.
  const freq = new Map<string, number>();
  const ajouter = (t: string | null) => { if (!t || t.includes(R)) return; for (const m of t.toLowerCase().matchAll(/[\p{L}]+/gu)) freq.set(m[0], (freq.get(m[0]) || 0) + 1); };
  for (const r of await tout<any>("content", "titre_simplifie, resume_flash, resume_detaille")) { ajouter(r.titre_simplifie); ajouter(r.resume_flash); ajouter(r.resume_detaille); }
  for (const r of await tout<any>("legislative_dossiers", "title")) ajouter(r.title);
  for (const r of await tout<any>("promulgated_laws", "title")) ajouter(r.title);
  console.log(`[Dictionnaire] ${freq.size} formes.`);
  const cache = new Map<string, string | null>();
  const inconnus = new Map<string, number>();
  const motRepare = (mot: string): string | null => {
    const bas = mot.toLowerCase();
    if (cache.has(bas)) return cache.get(bas)!;
    const re = new RegExp(`^${bas.split(R).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(`[${ACCENTS.toLowerCase()}]`)}$`);
    let meilleur: string | null = null, n = 0;
    for (const [f, c] of freq) if (c > n && re.test(f)) { meilleur = f; n = c; }
    // Repli : le « é », de loin le plus fréquent.
    const r = meilleur ?? null;
    cache.set(bas, r);
    return r;
  };

  const reparer = (t: string): string => {
    if (!t.includes(R)) return t;
    // « N� 107 », « n� 2021-1017 » (un N isolé suivi d'un nombre) et « 58-2� » : le degré.
    let s = t.replace(new RegExp(`(?<!\\p{L})([Nn])${R}(?=\\s*\\d)`, "gu"), "$1°").replace(new RegExp(`(\\d)${R}`, "g"), "$1°");
    // Mots abîmés.
    s = s.replace(new RegExp(`[\\p{L}${R}]*${R}[\\p{L}${R}]*`, "gu"), mot => {
      if (mot === R) return mot;
      const f = motRepare(mot);
      if (!f) { inconnus.set(mot, (inconnus.get(mot) || 0) + 1); return mot.replace(new RegExp(R, "g"), "é"); }
      if (mot[0] === mot[0].toUpperCase() && mot[0] !== mot[0].toLowerCase()) return f[0].toUpperCase() + f.slice(1);
      if (mot[0] === R && /^[\s\-–—«"(]*$/.test(t.slice(0, t.indexOf(mot)))) return f[0].toUpperCase() + f.slice(1);   // en tête de texte
      return f;
    });
    // « � » seul : guillemet après un article ou un tiret, sinon « à ».
    const morceaux = s.split(new RegExp(`(?<=^|\\s)${R}(?=\\s|$)`));
    if (morceaux.length === 1) return s;
    let ouvert = false, res = morceaux[0];
    for (let i = 1; i < morceaux.length; i++) {
      const avant = res.trimEnd().split(/\s+/).pop()?.toLowerCase() || "";
      const debut = res.trim() === "";
      let c: string;
      if (ouvert) { c = "»"; ouvert = false; }
      else if (/^(le|la|les|l'|du|des|de|d'|au|aux|un|une|en|-|–|—|\(|:)$/.test(avant) && morceaux.slice(i + 1).length) { c = "«"; ouvert = true; }
      else c = debut ? "À" : "à";
      res += c + morceaux[i];
    }
    return res;
  };

  // 3. Les articles abîmés.
  const abimes = await tout<any>("content", `id, source_url, ${CHAMPS.join(", ")}`,
    q => q.or(CHAMPS.map(c => `${c}.like.*${R}*`).join(",")));
  console.log(`[Articles] ${abimes.length} à réparer.`);
  let parFlux = 0, ecrits = 0;
  const exemples: string[] = [];
  for (const a of abimes) {
    const maj: Record<string, string> = {};
    const f = flux.get(cleUrl(a.source_url));
    for (const c of CHAMPS) {
      const v: string | null = a[c];
      if (!v || !v.includes(R)) continue;
      let n = reparer(v);
      // Le flux donne le vrai titre quand l'article y figure encore.
      if (f && c === "titre_original" && f.titre && !f.titre.includes(R)) { n = f.titre; parFlux++; }
      maj[c] = n;
    }
    if (exemples.length < 14 && maj.titre_original) exemples.push(`${a.titre_original}\n   → ${maj.titre_original}`);
    if (ECRIRE && Object.keys(maj).length) {
      const { error } = await supabase.from("content").update(maj).eq("id", a.id);
      if (error) console.log(`  ! ${a.id} : ${error.message}`); else ecrits++;
    }
  }
  console.log(`\n${exemples.join("\n")}\n`);
  console.log(`[Bilan] ${parFlux} titre(s) repris des flux ; mots sans correspondance : ${[...inconnus].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([m, n]) => `${m}×${n}`).join(", ") || "aucun"}`);
  console.log(ECRIRE ? `[Écrit] ${ecrits} article(s) réparé(s).` : "(essai : rien n'est écrit ; relancer avec --ecrire)");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
