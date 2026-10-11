import "dotenv/config";
import crypto from "crypto";
import { supabase } from "../../config/supabase.js";
import { enAttente, signaler, sansAccent, type Item } from "../../lib/cycles.js";
import type { Brouillon } from "./programmes-redacteur.js";

/**
 * CYCLE PROGRAMMES — agents 3 et 4 : le vérificateur, puis la mise en ligne.
 *
 * LE VÉRIFICATEUR ne rédige rien et n'utilise aucune IA : il confronte chaque proposition du
 * brouillon au texte source, mot à mot. Un modèle qui se relit lui-même se donne raison ;
 * une comparaison de texte, non.
 *  - Tout chiffre d'une proposition doit figurer tel quel dans la source.
 *  - Ses mots porteurs de sens doivent s'y retrouver ENSEMBLE, dans un même passage
 *    (au moins sept sur dix).
 * Une proposition qui échoue est retirée du brouillon, et son motif noté. Si trop de
 * propositions tombent, c'est le brouillon entier qui est suspect : il part en « a_revoir ».
 *
 * LA MISE EN LIGNE n'a lieu que si PROGRAMMES_PUBLICATION_AUTO=1. Sans ce drapeau, le
 * brouillon vérifié attend à l'étape « verifie » et le contrôleur le signale : c'est le mode
 * d'observation, où l'on compare ce que les agents auraient publié à ce qui est en ligne.
 * Quand elle a lieu, elle ne touche QUE les lignes de cette source : le reste de la fiche,
 * rédigé à la main ou par une autre tâche, n'est jamais modifié.
 *
 * Usage : npx tsx src/scripts/agents/programmes-verificateur.ts
 */
const AGENT = "programmes-verificateur";
const PUBLIER = process.env.PROGRAMMES_PUBLICATION_AUTO === "1";
const CONTEXTE = "__contexte__";
const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");
const norm = (s: string) => sansAccent(s).replace(/[^a-z0-9]+/g, " ").trim();

const FENETRE = 900, PAS = 300, SEUIL = 0.7;

const VIDES = new Set(["candidat", "candidate", "propose", "veut", "souhaite", "entend", "mettre", "place", "faire",
  "ainsi", "afin", "notamment", "toutes", "leurs", "cette", "entre", "avoir", "etre", "selon", "aussi", "leur", "plus"]);

/** Une proposition tient-elle dans le texte source ? */
export function fidele(proposition: string, source: string, sourceChiffres: string): { ok: boolean; motif?: string } {
  // Chiffres : comparés sans espaces ni séparateurs, « 12 000 » et « 12000 » sont le même nombre.
  for (const c of proposition.match(/\d[\d\s.,]*\d|\d/g) ?? []) {
    const brut = c.replace(/[\s.,]/g, "");
    if (brut.length && !sourceChiffres.includes(brut)) return { ok: false, motif: `chiffre absent de la source : ${c.trim()}` };
  }
  const mots = [...new Set(norm(proposition).split(" ").filter(m => m.length >= 5 && !VIDES.has(m)))];
  if (mots.length < 3) return { ok: true };
  // Racine : « logements » retrouve « logement », « garantira » retrouve « garantir ».
  const racines = mots.map(m => m.slice(0, Math.max(5, m.length - 3)));
  // Les mots doivent se retrouver ENSEMBLE, dans un même passage. Cherchés dans toute la
  // page, ils s'y trouvent presque toujours : une phrase inventée de toutes pièces, faite de
  // mots du sujet, passerait le contrôle.
  let meilleur = 0;
  for (let i = 0; i < source.length && meilleur < 1; i += PAS) {
    const passage = source.slice(i, i + FENETRE);
    const part = racines.filter(r => passage.includes(r)).length / racines.length;
    if (part > meilleur) meilleur = part;
  }
  return meilleur >= SEUIL ? { ok: true }
    : { ok: false, motif: `aucun passage de la source ne la porte (${Math.round(meilleur * 100)} % des mots au mieux)` };
}

export function verifier(brouillon: Brouillon, texte: string) {
  const source = norm(texte);
  const sourceChiffres = texte.replace(/[\s.,  ]/g, "");
  const garde: Brouillon = [];
  const rejets: { theme: string; proposition: string; motif: string }[] = [];
  for (const t of brouillon) {
    const ok: string[] = [];
    for (const p of t.propositions) {
      const v = fidele(p, source, sourceChiffres);
      if (v.ok) ok.push(p); else rejets.push({ theme: t.theme, proposition: p, motif: v.motif! });
    }
    // Le contexte obéit à la même règle : il ne doit rien affirmer que la page ne dise.
    const contexte = t.contexte && fidele(t.contexte, source, sourceChiffres).ok ? t.contexte : null;
    if (ok.length) garde.push({ theme: t.theme, contexte, propositions: ok });
  }
  const total = brouillon.reduce((n, t) => n + t.propositions.length, 0);
  const gardees = garde.reduce((n, t) => n + t.propositions.length, 0);
  return { garde, rejets, total, gardees };
}

async function publier(item: Item, brouillon: Brouillon): Promise<number> {
  const candidat = item.donnees.candidate_id as string;
  const url = item.source_url!;
  const { data: dernier } = await supabase.from("candidate_proposals").select("sort_order")
    .eq("candidate_id", candidat).order("sort_order", { ascending: false }).limit(1);
  let ordre = (dernier?.[0]?.sort_order ?? -1) + 1;
  const lignes: any[] = [];
  const maintenant = new Date().toISOString();
  for (const t of brouillon) {
    if (t.contexte) lignes.push({ id: md5(`${candidat}|ctx|${norm(t.theme)}`), candidate_id: candidat, theme: t.theme,
      subsection: CONTEXTE, text: t.contexte, source_url: url, sort_order: ordre++, updated_at: maintenant });
    for (const p of t.propositions) lignes.push({ id: md5(`${candidat}|${norm(p)}`), candidate_id: candidat, theme: t.theme,
      subsection: null, text: p, source_url: url, sort_order: ordre++, updated_at: maintenant });
  }
  const uniques = [...new Map(lignes.map(l => [l.id, l])).values()];
  // Seules les lignes de CETTE source sont remplacées.
  await supabase.from("candidate_proposals").delete().eq("candidate_id", candidat).eq("source_url", url);
  const { error } = await supabase.from("candidate_proposals").upsert(uniques, { onConflict: "id" });
  if (error) throw new Error(error.message);
  return uniques.length;
}

async function main() {
  console.log(`=== Programmes · vérificateur${PUBLIER ? " + mise en ligne" : " (observation : rien n'est publié)"} ===`);
  const file = [...await enAttente("programmes", "redige", 20), ...(PUBLIER ? await enAttente("programmes", "verifie", 20) : [])];
  if (!file.length) { console.log("  Rien à vérifier."); return; }

  for (const item of file) {
    let verifie: Brouillon = item.donnees.brouillon_verifie;
    if (item.etape === "redige") {
      const { garde, rejets, total, gardees } = verifier(item.donnees.brouillon ?? [], item.donnees.texte ?? "");
      const tauxRejet = total ? rejets.length / total : 1;
      console.log(`  ${item.sujet} · ${item.titre ?? item.cle} : ${gardees}/${total} proposition(s) fidèle(s)`);
      for (const r of rejets.slice(0, 8)) console.log(`      ✗ ${r.proposition.slice(0, 90)} — ${r.motif}`);
      const suspect = gardees < 3 || tauxRejet > 0.25;
      await signaler(AGENT, item, {
        cycle: "programmes", cle: item.cle, etape: suspect ? "a_revoir" : "verifie",
        erreur: suspect ? `Brouillon suspect : ${rejets.length} proposition(s) sur ${total} sans appui dans la source.` : null,
        donnees: { brouillon_verifie: garde, rejets, verifie_le: new Date().toISOString() },
      });
      if (suspect) continue;
      item.etape = "verifie";
      verifie = garde;
    }
    if (!PUBLIER || !verifie?.length || !item.donnees.candidate_id) continue;
    try {
      const n = await publier(item, verifie);
      await signaler(AGENT, item, { cycle: "programmes", cle: item.cle, etape: "en_ligne", donnees: { publie: n } });
      console.log(`    → en ligne : ${n} ligne(s) sur la fiche`);
    } catch (e: any) { console.warn(`    ! mise en ligne : ${e.message}`); }
  }
}

if (process.argv[1]?.endsWith("programmes-verificateur.ts")) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
