import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createReadStream, createWriteStream, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { supabase } from "../../config/supabase.js";
import { fetchAll } from "../automation/generate-interest-notifications.js";

/**
 * Amendements du Sénat (offre Pro) : le pendant de sync-amendements-an, une fois par jour.
 *
 * Source : AMELI, la base officielle du Sénat, publiée chaque nuit sur data.senat.fr (dump
 * PostgreSQL en latin-1). Elle donne l'auteur et son groupe, le sort, le dispositif, l'objet, si
 * l'amendement est de séance ou de commission, et les amendements identiques (ideid). Elle ne
 * date pas le sort : sort_le est le jour où on l'a vu changer.
 *
 * Lien avec les scrutins publics (legislative_scrutins) : « sur l'amendement n° 79, présenté par
 * Mme Edwige Diaz…, à l'article 2 du projet de loi… ». Il faut le numéro, le nom de l'auteur en
 * mot entier, un dépôt antérieur au vote et un sort conforme au résultat. Les identiques reçoivent
 * le même scrutin s'ils ont le même sort. Sans scrutin : 'main_levee' en séance, 'commission' sinon.
 *
 * Les amendements déposés depuis octobre 2025 sont gardés entiers ; avant, seuls les amendements tranchés par
 * un scrutin public, pour ne pas charger la base avec tout l'historique.
 *   --sec            n'écrit rien        --dump=ameli.sql   dump déjà extrait
 */
const EXPORT = "https://data.senat.fr/data/ameli/ameli.zip";
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split("=")[1];
const SEC = process.argv.includes("--sec");
const DEPOT_COMPLET = "2025-10-01";
const DEPOT_MIN = "2024-09-01";
const TABLES = new Set(["amd", "amdsen", "com_ameli", "grppol_ameli", "lec_ameli", "nat", "sai", "sen_ameli", "ses", "sub", "txt_ameli"]);
const COLONNES_AMD = ["id", "subid", "sorid", "txtid", "ideid", "num", "rev", "typ", "dis", "obj", "datdep", "ord", "nomentid", "numabs", "irrid"];

const SORTS: Record<string, string> = { A: "Adopté", B: "Adopté", J: "Rejeté", K: "Rejeté", R: "Retiré", N: "Non soutenu", S: "Tombé", "1": "Adopté", "2": "Adopté", "3": "Rejeté", "4": "Retiré", "5": "Tombé" };
const RECTIFIE = ["", "rect.", "rect. bis", "rect. ter", "rect. quater", "rect. quinquies", "rect. sexies", "rect. septies", "rect. octies", "rect. nonies", "rect. decies"];

const sansAccent = (t: string) => (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ /g, " ");
const brut = (html: string | null | undefined) => {
  const t = String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t  ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t || null;
};
// Échappements du format COPY de PostgreSQL.
const copie = (v: string) => (v === "\\N" ? null : v.includes("\\") ? v.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c)) : v);
// « LE GLEUT », « CHAIN-LARCHÉ » → « Le Gleut », « Chain-Larché ». Nom de groupe : « groupe du RDSE » → « RDSE ».
const nomPropre = (t: string) => t.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
const nomGroupe = (t: string | null | undefined) => (t || "").replace(/^groupe\s+(?:du\s+|de\s+l['’]|de la\s+|des\s+|de\s+)?/i, "").trim() || null;
const motEntier = (nom: string, texte: string) => !nom || new RegExp(`(^|[^a-z])${nom.replace(/[^a-z0-9 -]/g, "")}($|[^a-z])`).test(texte);

async function lireDump(chemin: string) {
  const t: Record<string, Record<string, string | null>[]> = {};
  let table: string | null = null; let cols: string[] = []; let garder: number[] = [];
  for await (const l of createInterface({ input: createReadStream(chemin, "latin1"), crlfDelay: Infinity })) {
    if (table === null) {
      const m = /^COPY (\w+) \((.*)\) FROM stdin;/.exec(l);
      if (m && TABLES.has(m[1])) {
        table = m[1]; t[table] = [];
        cols = m[2].split(", ").map(c => c.replace(/"/g, ""));
        garder = cols.map((c, i) => (table !== "amd" || COLONNES_AMD.includes(c) ? i : -1)).filter(i => i >= 0);
      } else if (m) { table = "_"; }
      continue;
    }
    if (l === "\\.") { table = null; continue; }
    if (table === "_") continue;
    const v = l.split("\t");
    const o: Record<string, string | null> = {};
    for (const i of garder) o[cols[i]] = copie(v[i] ?? "\\N");
    t[table].push(o);
  }
  return t;
}

async function main() {
  const travail = mkdtempSync(join(tmpdir(), "ameli-"));
  try {
    let dump = arg("dump");
    if (!dump) {
      const zip = join(travail, "a.zip");
      // Téléchargement du Sénat parfois coupé (échec du 07/11/2026) : quatre essais espacés.
      for (let essai = 1; ; essai++) {
        try {
          const r = await fetch(EXPORT, { signal: AbortSignal.timeout(900_000) });
          if (!r.ok || !r.body) throw new Error(`AMELI : HTTP ${r.status}`);
          await pipeline(Readable.fromWeb(r.body as any), createWriteStream(zip));
          break;
        } catch (e) {
          if (essai >= 4) throw e;
          console.log(`::warning::AMELI : téléchargement interrompu (essai ${essai}/4) — ${(e as Error).message}`);
          await new Promise(res => setTimeout(res, essai * 20000));
        }
      }
      execFileSync("unzip", ["-o", "-q", "-j", zip, "-d", travail], { maxBuffer: 1e8 });
      const sql = readdirSync(travail).find(f => f.endsWith(".sql"));
      if (!sql) throw new Error("AMELI : dump introuvable dans l'archive");
      dump = join(travail, sql);
    }
    const T = await lireDump(dump);
    console.log(`[Sénat] AMELI : ${T.amd.length} amendements, ${T.txt_ameli.length} textes.`);
    if (T.amd.length < 100_000) throw new Error("AMELI : dump incomplet ?");

    const sessions = new Map(T.ses.map(s => [s.id!, s]));
        const libSession = (id: string | null) => /\d{4}-\d{4}/.exec(sessions.get(id || "")?.lil || "")?.[0] || null;
    const natures = new Map(T.nat.map(n => [n.id!, n.lib]));
    const textes = new Map(T.txt_ameli.map(x => [x.id!, x]));
    const subdivisions = new Map(T.sub.map(s => [s.id!, s.lib]));
    const groupes = new Map(T.grppol_ameli.map(g => [g.entid!, g]));
    const commissions = new Map(T.com_ameli.map(c => [c.entid!, c.lib]));
    const senateurs = new Map(T.sen_ameli.map(s => [s.entid!, s]));
    const commissionTexte = new Map(T.sai.filter(s => s.comid).map(s => [s.txtid!, commissions.get(s.comid!) || null]));
    const signataires = new Map<string, typeof T.amdsen>();
    for (const s of T.amdsen) { const l = signataires.get(s.amdid!); if (l) l.push(s); else signataires.set(s.amdid!, [s]); }
    for (const l of signataires.values()) l.sort((a, b) => Number(a.rng) - Number(b.rng));

    const { data: sen } = await supabase.from("senators").select("slug, senate_matricule");
    const slugs = new Map((sen || []).filter(s => s.senate_matricule).map(s => [s.senate_matricule, s.slug]));
    const maintenant = new Date().toISOString();

    type Fiche = { id: string; num: string; nom: string; sort: string | null; ideid: string | null; depot: number; recent: boolean; seance: boolean; ligne: any; mots: string };
    const fiches: Fiche[] = [];
    for (const a of T.amd) {
      const x = textes.get(a.txtid || "");
      if (!x || !a.num) continue;
      if ((a.datdep || "") < DEPOT_MIN) continue;
      // Sans dispositif ni objet : amendement en cours de saisie, pas encore public.
      const dispositif = brut(a.dis); const expose = brut(a.obj);
      if (!dispositif && !expose) continue;
      const seance = x.txttyp === "S";
      const signes = signataires.get(a.id!) || [];
      const premier = signes[0];
      const entite = a.nomentid || "";
      const comAuteur = commissions.get(entite) || null;
      const auteur = premier ? `${premier.qua || ""} ${premier.prenomuse || ""} ${nomPropre(premier.nomuse || "")}`.replace(/\s+/g, " ").trim()
        : entite === "5" ? "Gouvernement" : comAuteur ? `Commission : ${comAuteur}` : null;
      const fiche = premier ? senateurs.get(premier.senid!) : null;
      const session = libSession(x.sesdepid);
      const numero = `${a.num}${RECTIFIE[Number(a.rev)] ? ` ${RECTIFIE[Number(a.rev)]}` : ""}`;
      const titre = [natures.get(x.natid || ""), x.int].filter(Boolean).join(" : ");
      const sort = SORTS[a.sorid || ""] || (a.irrid ? "Irrecevable" : null);
      fiches.push({
        id: a.id!, num: a.num.toLowerCase(), nom: sansAccent(premier?.nomuse || ""), sort, ideid: a.ideid, depot: new Date(a.datdep || 0).getTime(), recent: (a.datdep || "") >= DEPOT_COMPLET, seance, mots: sansAccent(x.int || ""),
        ligne: {
          uid: `SEN${a.id}`, numero, texte_uid: x.doslegsignet || `SENTXT${x.id}`, texte_titre: titre || null, texte_numero: x.num, session,
          organe: seance ? "Séance publique" : `Commission${commissionTexte.get(x.id!) ? ` · ${commissionTexte.get(x.id!)}` : ""}`,
          division: subdivisions.get(a.subid || "") || null, ordre: a.ord, sort, auteur, auteur_type: premier ? "Sénateur" : entite === "5" ? "Gouvernement" : comAuteur ? "Commission" : null,
          groupe: premier ? nomGroupe(groupes.get(premier.grpid || "")?.libcou) : null,
          senateur_slug: fiche?.mat ? slugs.get(fiche.mat) || null : null,
          cosignataires: signes.length > 1 ? signes.slice(1).map(s => `${s.prenomuse} ${nomPropre(s.nomuse || "")}`).join(", ") : null, nb_cosignataires: Math.max(0, signes.length - 1),
          sous_amendement: a.typ === "S", dispositif, expose,
          url: session && x.num ? `https://www.senat.fr/amendements/${seance ? "" : "commissions/"}${session}/${x.num}/Amdt_${a.num}.html` : null,
          depose_le: a.datdep ? new Date(a.datdep).toISOString() : null, vu_le: a.datdep ? new Date(a.datdep).toISOString() : maintenant,
          ideid: a.ideid, maj_le: maintenant,
        },
      });
    }
    console.log(`[Sénat] ${fiches.length} amendement(s) publics depuis le ${DEPOT_MIN}.`);

    // Résultat officiel lu par sync-scrutins-senat-groupes ; à défaut, pour > contre.
    const scrutins = await fetchAll("legislative_scrutins", "id, official_id, title, voted_at, for_count, against_count, result_label",
      q => q.eq("chamber", "SENAT").ilike("title", "%amendement%"));
    const parNumero = new Map<string, Fiche[]>();
    for (const f of fiches) if (f.seance) { const l = parNumero.get(f.num); if (l) l.push(f); else parNumero.set(f.num, [f]); }
    const parIde = new Map<string, Fiche[]>();
    for (const f of fiches) if (f.ideid) { const l = parIde.get(f.ideid); if (l) l.push(f); else parIde.set(f.ideid, [f]); }

    const liaisons = new Map<string, string>();
    let scrutinsLies = 0; const nonLies: string[] = [];
    for (const s of scrutins as any[]) {
      const titre = sansAccent(s.title || "");
      const tete = titre.split(/,\s*(?:a|au|aux|apres|avant|tendant)\s|\s+a l'(?:amendement|article)/)[0];
      const quand = new Date(s.voted_at).getTime();
      const adopte = s.result_label ? /adopt/i.test(s.result_label) && !/pas adopt/i.test(s.result_label) : (s.for_count || 0) > (s.against_count || 0);
      const nums = [...tete.matchAll(/(?:n[°o]\s*|amendements?\s+)((?:[a-z]+-)?\d+)/gi)].map(m => m[1].toLowerCase());
      let lie = false;
      for (const num of nums) {
        let cands = (parNumero.get(num) || []).filter(f =>
          f.depot <= quand + 864e5 && quand - f.depot < 150 * 864e5 && f.sort === (adopte ? "Adopté" : "Rejeté")
          && (f.nom ? motEntier(f.nom.split(/\s+/).pop() || "", tete) : /gouvernement|commission/.test(tete)));
        if (cands.length > 1) {
          const mots = new Set(titre.split(/[^a-z0-9]+/).filter(m => m.length >= 5));
          const score = (f: Fiche) => [...new Set(f.mots.split(/[^a-z0-9]+/))].filter(m => mots.has(m)).length;
          const max = Math.max(...cands.map(score));
          cands = cands.filter(f => score(f) === max).sort((a, b) => Math.abs(quand - a.depot) - Math.abs(quand - b.depot));
        }
        const choisi = cands[0];
        if (!choisi) continue;
        liaisons.set(choisi.id, s.id); lie = true;
        for (const f of choisi.ideid ? parIde.get(choisi.ideid) || [] : []) if (f.sort === choisi.sort) liaisons.set(f.id, s.id);
      }
      if (lie) scrutinsLies++; else nonLies.push(`${s.official_id} : ${(s.title || "").slice(0, 110)}`);
    }
    console.log(`[Sénat] ${scrutinsLies}/${scrutins.length} scrutins d'amendement reliés, ${liaisons.size} amendements concernés.`);
    for (const n of nonLies.slice(0, 10)) console.log(`  non relié · ${n}`);

    const lignes = fiches
      .filter(f => f.recent || liaisons.has(f.id))
      .map(f => {
        const tranche = f.sort === "Adopté" || f.sort === "Rejeté";
        return { ...f.ligne, scrutin_id: liaisons.get(f.id) || null, vote_mode: liaisons.has(f.id) ? "scrutin_public" : !tranche ? null : f.seance ? "main_levee" : "commission" };
      });
    const parMode: Record<string, number> = {};
    for (const l of lignes) parMode[String(l.vote_mode)] = (parMode[String(l.vote_mode)] || 0) + 1;
    console.log(`[Sénat] ${lignes.length} ligne(s) à la base : ${JSON.stringify(parMode)}.`);
    if (SEC) {
      for (const l of lignes.filter(x => x.scrutin_id).slice(-4)) console.log(`  ${l.uid} · ${l.numero} · ${l.auteur} · ${l.groupe} · ${l.sort} · ${l.division} · ${l.url} · ${(l.texte_titre || "").slice(0, 60)}`);
      return;
    }

    // sort_le : le jour où on voit le sort changer ; au premier passage, la date de dépôt (pas de rafale d'alertes).
    const avant = new Map<string, { sort: string | null; sort_le: string | null }>();
    for (const l of await fetchAll("amendements_senat", "uid, sort, sort_le", q => q)) avant.set((l as any).uid, l as any);
    // Sinon un amendement déposé la veille serait antérieur à la dernière alerte et n'en déclencherait aucune.
    const premier = avant.size === 0;
    const aEcrire = lignes.map(l => {
      const c = avant.get(l.uid);
      const sort_le = !l.sort ? null : c?.sort === l.sort ? c.sort_le : c || !premier ? maintenant : l.depose_le;
      return { ...l, sort_le, vu_le: c ? undefined : premier ? l.vu_le : maintenant };
    }).map(({ vu_le, ...r }) => (vu_le ? { ...r, vu_le } : r));
    const lots = [aEcrire.filter(l => "vu_le" in l), aEcrire.filter(l => !("vu_le" in l))];
    for (const lot of lots) for (let i = 0; i < lot.length; i += 400) {
      const { error } = await supabase.from("amendements_senat").upsert(lot.slice(i, i + 400), { onConflict: "uid" });
      if (error) throw error;
      if (i % 8000 === 0 && i) console.log(`  … ${i}/${lot.length}`);
    }
    console.log(`[Sénat] Terminé : ${aEcrire.length} ligne(s) à jour, dont ${lots[0].length} nouvelles.`);
  } finally {
    rmSync(travail, { recursive: true, force: true });
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
