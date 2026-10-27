import "dotenv/config";
import { supabase } from "../../config/supabase.js";

/**
 * Amendements de l'Assemblée nationale en temps réel (offre Pro) — toutes les heures.
 *
 * Source : Eliasse, l'application de séance de l'AN (API publique, sans clé).
 *   /examens                    textes en cours d'examen, en séance et en commission
 *   /examens/{examen}/derouleur tous les amendements de l'examen, dans l'ordre de discussion, avec leur sort
 *   /textes/{texte}/examens/{examen}/amendements/{uid}/with_neighbors
 *                               le détail (auteur, cosignataires, dispositif, exposé) de
 *                               l'amendement et de ses voisins — ~5 par appel
 *
 * Chaque passage : nouveaux amendements insérés (vu_le = première apparition, Eliasse ne
 * donne pas la date de dépôt), sorts mis à jour, détail complété pour ceux qui n'en ont
 * pas encore (MAX_DETAILS appels au plus — le premier passage rattrape ~10 000 amendements
 * en plusieurs heures).
 *
 *   --sec  : n'écrit rien, affiche ce qui changerait
 */
const API = "https://eliasse.assemblee-nationale.fr/api-eliasse";
const SEC = process.argv.includes("--sec");
const MAX_DETAILS = Number(process.env.AMENDEMENTS_MAX_DETAILS || 1500);
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

async function lire<T = any>(chemin: string): Promise<T | null> {
  for (let essai = 1; essai <= 3; essai++) {
    const r = await fetch(API + chemin, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(45000) }).catch(() => null);
    if (r?.ok) return r.json() as Promise<T>;
    if (r && r.status === 404) return null;
    await pause(2000 * essai);
  }
  console.warn(`[Amendements] échec ${chemin}`);
  return null;
}

// HTML de l'AN → texte brut (paragraphes conservés) : rien d'exécutable n'arrive sur le site.
function texte(html: string | null | undefined): string | null {
  const t = String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t  ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t || null;
}
const espaces = (s: string | null | undefined) => (s || "").replace(/[  ]/g, " ").trim();
const sortPropre = (s: string | null | undefined) => { const v = espaces(s); return !v || v === "Aucun" ? null : v; };

type Base = {
  uid: string; numero: string; texte_uid: string; texte_titre: string | null; texte_numero: string | null; examen_uid: string;
  organe_ref: string | null; organe: string | null; division: string | null; ordre: string | null; sort: string | null;
  auteur: string | null; sous_amendement: boolean;
};

async function main() {
  const examens = await lire<any[]>("/examens");
  if (!examens?.length) throw new Error("Eliasse : aucun examen (API indisponible ?)");
  // Libellés courts : « Commission · Finances », « Commission spéciale · Réponse intégrale ».
  const court = (o: any) => o.uid === "PO838901" ? "Séance publique"
    : /^CS /.test(o.libelleAbrege || "") ? `Commission spéciale · ${o.libelleAbrege.slice(3)}` : `Commission · ${o.libelleAbrege || o.libelle}`;
  const organes = new Map(((await lire<any[]>("/organes")) || []).map(o => [o.uid, court(o)]));
  const { data: deps } = await supabase.from("deputies").select("an_id, slug, party");
  const deputes = new Map((deps || []).filter(d => d.an_id).map(d => [d.an_id, d]));

  const bases = new Map<string, Base>();
  for (const ex of examens) {
    const der = await lire<any>(`/examens/${ex.uid}/derouleur`);
    for (const place of der?.places || []) for (const a of place.amendements || []) {
      if (a.estVisible === false || bases.has(a.uid)) continue;
      bases.set(a.uid, {
        uid: a.uid, numero: espaces(a.numero), texte_uid: ex.texte.uid, texte_titre: espaces(ex.texte.libelle) || null,
        texte_numero: ex.texte.bibard || null, examen_uid: ex.uid, organe_ref: ex.organeRef, organe: organes.get(ex.organeRef) || ex.organeRef,
        division: espaces(place.libelle) || null, ordre: a.ordre || null, sort: sortPropre(a.sort), auteur: espaces(a.auteur?.libelle) || null,
        sous_amendement: !!a.estSousAmendement,
      });
    }
    await pause(150);
  }
  console.log(`[Amendements] ${examens.length} examens, ${bases.size} amendements dans les dérouleurs.`);

  // Ce que la base connaît déjà.
  const connus = new Map<string, { numero: string; sort: string | null; ordre: string | null; division: string | null; organe: string | null; auteur_ref: string | null }>();
  const uids = [...bases.keys()];
  for (let i = 0; i < uids.length; i += 400) {
    const { data, error } = await supabase.from("amendements_an").select("uid, numero, sort, ordre, division, organe, auteur_ref").in("uid", uids.slice(i, i + 400));
    if (error) throw error;
    for (const r of data || []) connus.set(r.uid, r);
  }

  const maintenant = new Date().toISOString();
  const nouveaux: any[] = []; const changes: any[] = [];
  for (const b of bases.values()) {
    const c = connus.get(b.uid);
    if (!c) nouveaux.push({ ...b, url: `https://www.assemblee-nationale.fr/dyn/17/amendements/${b.uid}`, ...(b.sort ? { sort_le: maintenant } : {}) });
    else if (c.sort !== b.sort || c.ordre !== b.ordre || c.division !== b.division || c.organe !== b.organe)
      // Seulement ce que le dérouleur fait bouger : le numéro et l'auteur du détail restent.
      changes.push({ uid: b.uid, numero: c.numero, texte_uid: b.texte_uid, examen_uid: b.examen_uid, sort: b.sort, ordre: b.ordre, division: b.division, organe: b.organe,
        maj_le: maintenant, ...(c.sort !== b.sort ? { sort_le: maintenant } : {}) });
  }
  console.log(`[Amendements] ${nouveaux.length} nouveau(x), ${changes.length} changement(s) de sort ou de place.`);
  if (!SEC) {
    for (const lot of [nouveaux, changes]) for (let i = 0; i < lot.length; i += 500) {
      const { error } = await supabase.from("amendements_an").upsert(lot.slice(i, i + 500), { onConflict: "uid" });
      if (error) throw error;
    }
  }

  // Détail : d'abord les nouveaux, puis ceux qui n'en ont pas encore.
  const enAttente = new Set([...nouveaux.map(n => n.uid), ...[...connus].filter(([, c]) => !c.auteur_ref).map(([u]) => u)].filter(u => bases.has(u)));
  let appels = 0; let completes = 0;
  for (const uid of [...enAttente]) {
    if (appels >= MAX_DETAILS) break;
    if (!enAttente.has(uid)) continue;
    const b = bases.get(uid)!;
    const voisins = await lire<any[]>(`/textes/${b.texte_uid}/examens/${b.examen_uid}/amendements/${uid}/with_neighbors`);
    appels++;
    const lignes: any[] = [];
    for (const a of voisins || []) {
      const base = bases.get(a.uid);
      if (!base || !enAttente.has(a.uid)) continue;
      enAttente.delete(a.uid);
      const ref = a.auteur?.ref || null;
      const dep = ref ? deputes.get(ref) : null;
      const cos = (a.cosignataires || []).filter((c: any) => c.uid !== ref);
      lignes.push({
        ...base, numero: espaces(a.numero) || base.numero,
        auteur_ref: ref || espaces(a.auteur?.typeAuteur) || "?", auteur: espaces(a.auteur?.libelle) || base.auteur, auteur_type: espaces(a.auteur?.typeAuteur) || null,
        groupe: dep?.party || null, depute_slug: dep?.slug || null,
        cosignataires: espaces(a.cosignatairesLibelle) || null, nb_cosignataires: cos.length,
        dispositif: texte(a.dispositif), expose: texte(a.exposeSommaire), maj_le: maintenant,
      });
    }
    // L'amendement demandé absent de la réponse (retiré entre-temps) : on ne le redemande pas ce passage-ci.
    enAttente.delete(uid);
    if (lignes.length && !SEC) {
      const { error } = await supabase.from("amendements_an").upsert(lignes, { onConflict: "uid" });
      if (error) throw error;
    }
    completes += lignes.length;
    if (appels % 100 === 0) console.log(`[Amendements] … ${appels} appels, ${completes} détails`);
    await pause(120);
  }
  console.log(`[Amendements] Détail complété pour ${completes} amendement(s) en ${appels} appel(s)${enAttente.size ? `, ${enAttente.size} au prochain passage` : ""}${SEC ? " — À SEC" : ""}.`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
