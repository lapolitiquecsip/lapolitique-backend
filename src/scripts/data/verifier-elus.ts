import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { fetchAll } from "../automation/generate-interest-notifications.js";
import { fonctionsDeputes, fonctionsEurodeputes, fonctionsSenateurs, type Fonction } from "../../lib/fonctions-officielles.js";
import { corrigerBio } from "../../lib/verif-bio.js";
import { envoyerMail, esc } from "../../lib/mail.js";

/**
 * La revue hebdomadaire des élus : gratuite, sans IA, sur les seules sources officielles.
 *
 * 1. Photographie les fonctions (Sénat, Assemblée, Parlement européen, répertoire des maires déjà en base).
 * 2. Compare à la semaine précédente : ce qui arrive, part ou change va dans elus_changements.
 * 3. Corrige les biographies que ces sources contredisent ; le doute est signalé, jamais tranché.
 * 4. Prévient les administrateurs de ce qui a bougé.
 *
 * Une catégorie dont la source échoue n'est pas touchée : l'échec fait sonner l'alarme à la fin.
 *   --sec        n'écrit rien, affiche tout
 *   --initial    premier passage : pose la photographie sans remplir le journal de 10 000 « nouveautés »
 *   --sans-bios  ne touche pas aux biographies
 *   --seulement=eurodepute  une seule catégorie
 */
const SEC = process.argv.includes("--sec"), INITIAL = process.argv.includes("--initial"), SANS_BIOS = process.argv.includes("--sans-bios");
const SEULE = process.argv.find(a => a.startsWith("--seulement="))?.split("=")[1];   // une seule catégorie
const RETRAIT_MAX = 0.6;   // au-delà, on croit plus à une source abîmée qu'à un renouvellement : rien n'est appliqué

const cleDe = (f: { elu_kind: string; elu_slug: string; categorie: string; cle: string }) => `${f.elu_kind}|${f.elu_slug}|${f.categorie}|${f.cle}`;

type Bilan = { kind: string; nb: number; ajouts: number; retraits: number; modifs: number; erreur?: string };

async function appliquer(kind: Fonction["elu_kind"], neuves: Fonction[]): Promise<{ bilan: Bilan; journal: any[] }> {
  // Une même fonction citée deux fois par la source ne compte qu'une fois.
  // L'Assemblée donne deux lignes à qui préside une commission (« Membre » et « Président ») : la responsabilité l'emporte.
  const uniques = new Map<string, Fonction>();
  for (const f of neuves) {
    const deja = uniques.get(cleDe(f));
    if (!deja || (/^membre/i.test(deja.qualite ?? "") && !/^membre/i.test(f.qualite ?? ""))) uniques.set(cleDe(f), f);
  }
  const avant = await fetchAll("elus_fonctions", "elu_kind, elu_slug, nom, categorie, cle, libelle, important, source_url", q => q.eq("elu_kind", kind))
    .catch(e => { if (SEC) return []; throw e; });   // essai à blanc avant la création de la table
  const parCle = new Map(avant.map((f: any) => [cleDe(f), f]));
  const ajouts = [...uniques.values()].filter(f => !parCle.has(cleDe(f)));
  const modifs = [...uniques.values()].filter(f => { const a: any = parCle.get(cleDe(f)); return a && a.libelle !== f.libelle; });
  const retraits = avant.filter((f: any) => !uniques.has(cleDe(f)));
  if (avant.length > 50 && retraits.length / avant.length > RETRAIT_MAX) {
    throw new Error(`${kind} : ${retraits.length} retraits sur ${avant.length}, photographie refusée`);
  }
  const journal: any[] = [];
  // Une catégorie encore vide n'a pas de « semaine précédente » : c'est sa photographie de départ, pas 34 000 nouveautés.
  if (!INITIAL && avant.length > 0) {
    const ligne = (f: any, nature: string, a: string | null, b: string | null) => ({ elu_kind: kind, elu_slug: f.elu_slug, nom: f.nom, nature, categorie: f.categorie, avant: a, apres: b, source_url: f.source_url });
    for (const f of ajouts) if (f.important) journal.push(ligne(f, "ajout", null, f.libelle));
    for (const f of modifs) if (f.important) journal.push(ligne(f, "modification", (parCle.get(cleDe(f)) as any).libelle, f.libelle));
    for (const f of retraits) if ((f as any).important) journal.push(ligne(f, "retrait", (f as any).libelle, null));
  }
  if (!SEC) {
    const aEcrire = [...ajouts, ...modifs, ...[...uniques.values()].filter(f => { const a: any = parCle.get(cleDe(f)); return a && a.important !== f.important; })];
    for (let i = 0; i < aEcrire.length; i += 500) {
      const { error } = await supabase.from("elus_fonctions").upsert(aEcrire.slice(i, i + 500).map(f => ({ ...f, maj_le: new Date().toISOString() })), { onConflict: "elu_kind,elu_slug,categorie,cle" });
      if (error) throw error;
    }
    for (const f of retraits as any[]) {
      const { error } = await supabase.from("elus_fonctions").delete().eq("elu_kind", kind).eq("elu_slug", f.elu_slug).eq("categorie", f.categorie).eq("cle", f.cle);
      if (error) throw error;
    }
    for (let i = 0; i < journal.length; i += 500) {
      const { error } = await supabase.from("elus_changements").insert(journal.slice(i, i + 500));
      if (error) throw error;
    }
    await supabase.from("elus_verification").upsert({ elu_kind: kind, verifie_le: new Date().toISOString(), nb_fonctions: uniques.size, nb_changements: journal.length }, { onConflict: "elu_kind" });
  }
  return { bilan: { kind, nb: uniques.size, ajouts: ajouts.length, retraits: retraits.length, modifs: modifs.length }, journal };
}

async function verifierBios(table: string, kind: Fonction["elu_kind"], fonctions: Fonction[], filtre: (q: any) => any) {
  const parElu = new Map<string, Fonction[]>();
  for (const f of fonctions) parElu.set(f.elu_slug, [...(parElu.get(f.elu_slug) || []), f]);
  const elus = await fetchAll(table, "slug, first_name, last_name, bio", filtre);
  const journal: any[] = [], aRevoir: string[] = [];
  let corrigees = 0;
  for (const e of elus as any[]) {
    // Sans photographie pour cet élu, aucune conclusion : l'absence de ligne n'est pas une preuve.
    const siennes = parElu.get(e.slug);
    if (!siennes || !e.bio) continue;
    const r = corrigerBio(e.bio, siennes);
    const nom = `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim();
    for (const p of r.aRevoir) aRevoir.push(`${nom} : ${p}`);
    if (!r.corrections.length) continue;
    corrigees++;
    for (const c of r.corrections) {
      journal.push({ elu_kind: kind, elu_slug: e.slug, nom, nature: "bio_corrigee", categorie: c.champ, avant: c.avant, apres: c.apres });
      if (SEC) console.log(`  ${nom} [${c.champ}]\n    - ${c.avant}\n    + ${c.apres ?? "(phrase retirée)"}`);
    }
    if (!SEC) {
      const { error } = await supabase.from(table).update({ bio: r.bio }).eq("slug", e.slug);
      if (error) throw error;
    }
  }
  if (!SEC && journal.length) {
    const { error } = await supabase.from("elus_changements").insert(journal);
    if (error) throw error;
  }
  console.log(`[Bios ${kind}] ${elus.length} lues, ${corrigees} corrigées, ${aRevoir.length} à revoir.`);
  return { corrigees, aRevoir, journal };
}

const PHRASE: Record<string, string> = { ajout: "Nouveau", retrait: "Fin", modification: "Changement", bio_corrigee: "Bio corrigée" };

async function prevenirAdministrateurs(bilans: Bilan[], journal: any[], aRevoir: string[], erreurs: string[]) {
  if (SEC || (!journal.length && !aRevoir.length && !erreurs.length)) return;
  const { data: admins } = await supabase.from("administrateurs").select("user_id");
  const lignes = journal.filter(j => j.nature !== "bio_corrigee").slice(0, 80)
    .map(j => `<li><strong>${esc(j.nom)}</strong> — ${PHRASE[j.nature]} : ${esc(j.apres ?? j.avant)}${j.nature === "modification" ? ` <span style="color:#64748b">(avant : ${esc(j.avant)})</span>` : ""}</li>`).join("");
  const bios = journal.filter(j => j.nature === "bio_corrigee").slice(0, 40)
    .map(j => `<li><strong>${esc(j.nom)}</strong> : ${esc(j.avant)}<br><span style="color:#64748b">→ ${esc(j.apres ?? "phrase retirée")}</span></li>`).join("");
  const html = `<h2>Revue des élus de la semaine</h2>
${erreurs.length ? `<p style="color:#b91c1c"><strong>Sources en échec, rien n'a été changé pour elles :</strong> ${esc(erreurs.join(" ; "))}</p>` : ""}
<p>${bilans.map(b => `${esc(b.kind)} : ${b.nb} fonctions`).join(" · ")}</p>
${lignes ? `<h3>Changements</h3><ul>${lignes}</ul>` : ""}
${bios ? `<h3>Biographies corrigées</h3><ul>${bios}</ul>` : ""}
${aRevoir.length ? `<h3>À revoir à la main</h3><ul>${aRevoir.slice(0, 40).map(a => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}`;
  for (const a of admins || []) {
    const { data } = await supabase.auth.admin.getUserById(a.user_id);
    if (data?.user?.email) await envoyerMail(data.user.email, `Revue des élus : ${journal.length} changement(s)${erreurs.length ? ", source en échec" : ""}`, html);
  }
}

async function main() {
  const bilans: Bilan[] = [], journal: any[] = [], erreurs: string[] = [], aRevoir: string[] = [];
  const etapes: { kind: Fonction["elu_kind"]; table: string; filtre: (q: any) => any; lire: () => Promise<Fonction[]> }[] = [
    { kind: "senateur", table: "senators", filtre: q => q.eq("sitting", true), lire: async () => fonctionsSenateurs(await fetchAll("senators", "slug, senate_matricule", q => q)) },
    { kind: "depute", table: "deputies", filtre: q => q.eq("sitting", true), lire: async () => fonctionsDeputes(await fetchAll("deputies", "slug, an_id, first_name, last_name", q => q)) },
    { kind: "eurodepute", table: "meps", filtre: q => q.eq("country", "France"), lire: async () => fonctionsEurodeputes(await fetchAll("meps", "id, slug, full_name, country", q => q)) },
  ];
  for (const e of etapes) {
    if (SEULE && SEULE !== e.kind) continue;
    try {
      const fonctions = await e.lire();
      console.log(`[${e.kind}] ${fonctions.length} fonctions officielles lues.`);
      const r = await appliquer(e.kind, fonctions);
      console.log(`[${e.kind}] +${r.bilan.ajouts} -${r.bilan.retraits} ~${r.bilan.modifs}, ${r.journal.length} au journal.`);
      if (SEC) for (const j of r.journal.slice(0, 40)) console.log(`  ${j.nature} ${j.nom} : ${j.apres ?? j.avant}`);
      bilans.push(r.bilan); journal.push(...r.journal);
      if (!SANS_BIOS) {
        const b = await verifierBios(e.table, e.kind, fonctions, e.filtre);
        journal.push(...b.journal); aRevoir.push(...b.aRevoir);
      }
    } catch (err: any) {
      const m = `${e.kind} : ${err?.message ?? err}`;
      console.log(`::error title=Revue des élus::${m}`);
      erreurs.push(m);
    }
  }
  // Maires : le répertoire national est déjà en base (sync-rne) ; on en note seulement les changements.
  if (!SEULE || SEULE === "maire") try {
    const maires = await fetchAll("mayors", "insee_code, slug, full_name, commune_name", q => q);
    if (maires.length < 30000) throw new Error(`${maires.length} maires seulement`);
    const lignes: Fonction[] = (maires as any[]).filter(m => m.slug).map(m => ({
      elu_kind: "maire", elu_slug: m.slug, nom: m.full_name, categorie: "mandat", cle: `insee:${m.insee_code}`, libelle: `Maire de ${m.commune_name}`,
      qualite: "Maire", organe: m.commune_name, depuis: null, important: true, source_url: "https://www.data.gouv.fr/datasets/repertoire-national-des-elus-1/",
    }));
    const r = await appliquer("maire", lignes);
    console.log(`[maire] +${r.bilan.ajouts} -${r.bilan.retraits}, ${r.journal.length} au journal.`);
    bilans.push(r.bilan); journal.push(...r.journal);
  } catch (err: any) {
    console.log(`::error title=Revue des élus::maire : ${err?.message ?? err}`);
    erreurs.push(`maire : ${err?.message ?? err}`);
  }
  if (aRevoir.length) {
    console.log(`À revoir (${aRevoir.length}) :`);
    for (const a of aRevoir) console.log(`  ? ${a}`);
  }
  await prevenirAdministrateurs(bilans, journal, aRevoir, erreurs);
  if (erreurs.length) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("verifier-elus.ts")) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
