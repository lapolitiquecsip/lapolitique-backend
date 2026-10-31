import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createWriteStream, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { supabase } from "../../config/supabase.js";
import { fetchAll } from "../automation/generate-interest-notifications.js";

/**
 * Amendements de séance disparus d'Eliasse (31/10/2026).
 *
 * Eliasse ne liste que les examens du moment : une fois la séance d'un texte finie, ses amendements
 * n'y sont plus. Le 31/10, 386 scrutins publics d'amendement sur 737 (45 jours) ne pointaient vers
 * aucun amendement, dont les 194 du PLFSS. L'export officiel de l'Assemblée les a tous, avec leur
 * sort : on complète la table depuis cet export, une fois par jour.
 *
 * Il donne aussi les amendements identiques. Un scrutin « sur l'amendement n° 1602 de M. Clouet et
 * l'amendement identique suivant » ne nomme que le premier ; discussionIdentique.idDiscussion permet
 * d'attribuer le même vote aux autres, si leur sort concorde avec le résultat du scrutin.
 *
 * Les lignes déjà présentes ne sont pas réécrites. lier-amendements-scrutins.ts relie ensuite le reste.
 *   --sec            n'écrit rien        --zip=fichier     export déjà téléchargé
 *   --depuis=AAAA-MM-JJ  sorts plus anciens ignorés (défaut : 60 jours, la table ne garde pas toute la législature)
 */
const EXPORT = "https://data.assemblee-nationale.fr/static/openData/repository/17/loi/amendements_div_legis/Amendements.json.zip";
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split("=")[1];
const SEC = process.argv.includes("--sec");
const DEPUIS = arg("depuis") || new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);

const sansAccent = (t: string) => (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&nbsp;| /g, " ");
const brut = (html: unknown) => {
  const t = (typeof html === "string" ? html : "")
    .replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t  ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t || null;
};
const chaine = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const COUPE = /\s(?:a|au|aux|apres|avant|de retablissement)\s(?:l['’]\s?|de\s)?(?:amendement|article|annexe|titre|chapitre|etat|ensemble)\b/;
const adopte = (r: string) => /adopt/i.test(r) && !/pas adopt/i.test(r);

/** Le titre du texte dans l'objet du scrutin : « du projet de loi de finances pour 2027 (première lecture). » */
function titreDepuisObjet(objet: string): string | null {
  const m = /\b(?:du|de la)\s+((?:projet|proposition) de loi[^(]*)/i.exec(objet || "");
  if (!m) return null;
  const t = m[1].trim().replace(/[.\s]+$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

type Fiche = { uid: string; numero: string; auteur: string; sort: string | null; date: string | null; discussion: string | null; ligne: any };

function lireFiche(chemin: string, deputes: Map<string, any>): Fiche | null {
  const brutJson = JSON.parse(readFileSync(chemin, "utf8"));
  // Export : { amendement: {…} } ; fiche à l'unité : l'objet directement.
  const a = brutJson.amendement ?? brutJson;
  const cycle = a.cycleDeVie || {};
  const sort = chaine(cycle.sort);
  const date = chaine(cycle.dateSort);
  if (!date || date.slice(0, 10) < DEPUIS) return null;
  const ref = chaine(a.signataires?.auteur?.acteurRef);
  const dep = ref ? deputes.get(ref) : null;
  const libelle = brut(a.signataires?.libelle) || "";
  const auteur = libelle.split(",")[0].trim();
  const cos = a.signataires?.cosignataires?.acteurRef;
  const numero = chaine(a.identification?.numeroLong) || "";
  const uid = chaine(a.uid)!;
  return {
    uid, numero, auteur, sort, date, discussion: chaine(a.discussionIdentique?.idDiscussion),
    ligne: {
      uid, numero, texte_uid: chaine(a.texteLegislatifRef), texte_numero: /B(?:TC)?(\d+)/.exec(a.texteLegislatifRef || "")?.[1] || null,
      examen_uid: chaine(a.examenRef), organe_ref: "PO838901", organe: "Séance publique",
      division: chaine(a.pointeurFragmentTexte?.division?.titre), ordre: chaine(a.triAmendement), sort, sort_le: date,
      auteur, auteur_ref: ref || chaine(a.signataires?.auteur?.typeAuteur) || "?", auteur_type: chaine(a.signataires?.auteur?.typeAuteur),
      groupe: dep?.party || null, depute_slug: dep?.slug || null,
      cosignataires: libelle.split(",").slice(1).join(",").trim() || null, nb_cosignataires: Array.isArray(cos) ? cos.length : cos ? 1 : 0,
      sous_amendement: !!chaine(a.amendementParentRef),
      dispositif: brut(a.corps?.contenuAuteur?.dispositif), expose: brut(a.corps?.contenuAuteur?.exposeSommaire),
      url: `https://www.assemblee-nationale.fr/dyn/17/amendements/${uid}`,
      // Date du sort, pas d'aujourd'hui : un rattrapage ne doit pas déclencher les alertes « nouvel amendement ».
      vu_le: date,
    },
  };
}

function* fichiers(dossier: string): Generator<string> {
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    const p = join(dossier, e.name);
    if (e.isDirectory()) yield* fichiers(p);
    else if (e.name.endsWith(".json")) yield p;
  }
}

async function main() {
  const travail = mkdtempSync(join(tmpdir(), "amendements-"));
  try {
    let zip = arg("zip");
    if (!zip) {
      zip = join(travail, "a.zip");
      const r = await fetch(EXPORT, { signal: AbortSignal.timeout(600_000) });
      if (!r.ok || !r.body) throw new Error(`Export AN : HTTP ${r.status}`);
      await pipeline(Readable.fromWeb(r.body as any), createWriteStream(zip));
    }
    // Séance seulement : l'export entier fait plus d'un Go une fois décompressé.
    execFileSync("unzip", ["-o", "-q", zip, "json/*/*/AMANR5L17PO838901*", "-d", travail], { maxBuffer: 1e8 });

    const { data: deps } = await supabase.from("deputies").select("an_id, slug, party");
    const deputes = new Map((deps || []).filter(d => d.an_id).map(d => [d.an_id, d]));
    const fiches: Fiche[] = [];
    let lus = 0;
    for (const f of fichiers(travail)) {
      lus++;
      const fiche = lireFiche(f, deputes);
      if (fiche) fiches.push(fiche);
    }
    console.log(`[Rattrapage] ${lus} amendements de séance lus, ${fiches.length} tranchés depuis le ${DEPUIS}.`);
    if (!fiches.length) throw new Error("Export sans amendement récent : format changé ?");

    const connus = new Set<string>();
    const uids = fiches.map(f => f.uid);
    for (let i = 0; i < uids.length; i += 400) {
      const { data, error } = await supabase.from("amendements_an").select("uid").in("uid", uids.slice(i, i + 400));
      if (error) throw error;
      for (const r of data || []) connus.add(r.uid);
    }

    const scrutins = await fetchAll("scrutins", "id, numero, objet, resultat, date_scrutin", q => q.eq("type", "AMENDEMENT").gte("date_scrutin", DEPUIS));

    // Titre du texte : celui déjà connu dans la table, sinon celui de l'objet d'un scrutin du même texte.
    const titres = new Map<string, string>();
    const textes = [...new Set(fiches.map(f => f.ligne.texte_uid).filter(Boolean))];
    for (let i = 0; i < textes.length; i += 100) {
      const { data } = await supabase.from("amendements_an").select("texte_uid, texte_titre").in("texte_uid", textes.slice(i, i + 100)).not("texte_titre", "is", null).limit(5000);
      for (const r of data || []) titres.set(r.texte_uid, r.texte_titre);
    }
    const parNumero = new Map<string, Fiche[]>();
    for (const f of fiches) {
      const n = f.numero.toLowerCase().replace(/\s*\(.*$/, "").replace(/^(?:i{1,3}|iv)-/, "").trim();
      parNumero.set(n, [...(parNumero.get(n) || []), f]);
    }
    const parDiscussion = new Map<string, Fiche[]>();
    for (const f of fiches) if (f.discussion) parDiscussion.set(f.discussion, [...(parDiscussion.get(f.discussion) || []), f]);

    // Scrutin → amendement nommé : numéro, auteur dans la tête de l'objet, et date du sort à 3 jours près.
    const liaisons = new Map<string, string>();
    let identiques = 0, discordants = 0;
    for (const s of scrutins as any[]) {
      const objet = sansAccent(s.objet || "");
      const tete = objet.split(COUPE)[0];
      const quand = new Date(s.date_scrutin).getTime();
      const gagne = adopte(s.resultat || "");
      for (const m of tete.matchAll(/n[°o]\s*([a-z0-9]+(?:-[a-z0-9]+)*)/gi)) {
        const trouve = (parNumero.get(m[1].toLowerCase()) || []).find(f => {
          const nom = sansAccent(f.auteur.split(/ et |,/)[0].replace(/^(m\.|mme|m)\s+/i, "")).split(/\s+/).pop() || "";
          return (!nom || new RegExp(`(^|[^a-z])${nom.replace(/[^a-z0-9-]/g, "")}($|[^a-z])`).test(tete)) && Math.abs(new Date(f.date!).getTime() - quand) < 3 * 864e5;
        });
        if (!trouve) continue;
        if (trouve.ligne.texte_uid && !titres.has(trouve.ligne.texte_uid)) {
          const t = titreDepuisObjet(s.objet);
          if (t) titres.set(trouve.ligne.texte_uid, t);
        }
        if (!/identique/.test(objet) || !trouve.discussion) continue;
        for (const f of parDiscussion.get(trouve.discussion) || []) {
          if (f.uid === trouve.uid) continue;
          // Un identique retiré ou non soutenu n'a pas été voté ; un sort contraire au scrutin signale une erreur.
          if (f.sort !== "Adopté" && f.sort !== "Rejeté") continue;
          if ((f.sort === "Adopté") !== gagne) { discordants++; continue; }
          liaisons.set(f.uid, s.id);
          identiques++;
        }
      }
    }

    const nouveaux = fiches.filter(f => !connus.has(f.uid)).map(f => ({ ...f.ligne, texte_titre: titres.get(f.ligne.texte_uid) || null, maj_le: new Date().toISOString() }));
    console.log(`[Rattrapage] ${nouveaux.length} amendement(s) à ajouter, ${identiques} identique(s) à relier${discordants ? `, ${discordants} au sort contraire écarté(s)` : ""}.`);
    if (SEC) {
      for (const n of nouveaux.slice(0, 3)) console.log(`  ${n.uid} · ${n.numero} · ${n.auteur} · ${n.groupe} · ${n.sort} · ${n.texte_titre}`);
      return;
    }
    for (let i = 0; i < nouveaux.length; i += 300) {
      const { error } = await supabase.from("amendements_an").upsert(nouveaux.slice(i, i + 300), { onConflict: "uid", ignoreDuplicates: true });
      if (error) throw error;
    }
    const paquets = new Map<string, string[]>();
    for (const [uid, sid] of liaisons) paquets.set(sid, [...(paquets.get(sid) || []), uid]);
    for (const [sid, lot] of paquets) {
      const { error } = await supabase.from("amendements_an").update({ scrutin_id: sid, vote_mode: "scrutin_public" }).in("uid", lot).is("scrutin_id", null);
      if (error) console.log(`  ! ${sid} : ${error.message}`);
    }
    console.log(`[Rattrapage] Terminé.`);
  } finally {
    rmSync(travail, { recursive: true, force: true });
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
