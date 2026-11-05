import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import AdmZip from "adm-zip";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";

/**
 * Débats en séance publique de l'Assemblée nationale : chaque prise de parole, cherchable (Pro).
 *
 * Source : comptes rendus intégraux au format Syceron, open data de l'Assemblée (un fichier par
 * séance, mis à jour chaque nuit ; le compte rendu « provisoire » du jour est remplacé par la
 * version définitive). Chaque paragraphe porte l'identifiant officiel de l'orateur (PA…, député
 * ou ministre) : les paragraphes consécutifs d'un même orateur, sous un même point de l'ordre du
 * jour, forment une intervention.
 *
 * Tables : seances_comptes_rendus (une ligne par séance, avec l'empreinte de son fichier : seules
 * les séances nouvelles ou modifiées sont relues) et seance_interventions (le texte, indexé pour
 * la recherche plein texte). Aucune IA.
 *   --dry       n'écrit rien, affiche le volume
 *   --tout      relit toutes les séances, même inchangées
 *   --fichier=… lit une archive déjà téléchargée
 */
const DRY = process.argv.includes("--dry");
const TOUT = process.argv.includes("--tout");
const SOURCE = "https://data.assemblee-nationale.fr/static/openData/repository/17/vp/syceronbrut/syseron.xml.zip";
const nettoie = (s: string) => s.replace(/ /g, " ").replace(/\s+/g, " ").trim();

type Intervention = { id: string; seance_uid: string; chambre: string; date_seance: string; point: string | null; acteur_ref: string | null; orateur: string | null; qualite: string | null; texte: string; ordre: number };

/** « 20261104140000000 » → ISO, heure de Paris. */
function dateSeance(v: string): string {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return new Date().toISOString();
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+01:00`).toISOString();
}

export function lireSeance(xml: string): { uid: string; date: string; etat: string; interventions: Intervention[] } {
  const $ = cheerio.load(xml, { xmlMode: true });
  const uid = $("compteRendu > uid").first().text().trim();
  const date = dateSeance($("metadonnees > dateSeance").first().text().trim());
  const etat = $("metadonnees > etat").first().text().trim();
  const out: Intervention[] = [];
  let courante: Intervention | null = null;
  $("contenu paragraphe").each((_, el) => {
    const p = $(el);
    const acteur = p.attr("id_acteur") || null;
    const texte = nettoie(p.children("texte").text());
    if (!acteur || !texte) { courante = null; return; }
    // Le président qui distribue la parole n'est pas une intervention de fond.
    if ((p.attr("roledebat") === "president" || p.attr("code_grammaire") === "PAROLE_GENERIQUE" || /^La parole est (à|a) /.test(texte)) && texte.length < 300) { courante = null; return; }
    const point = nettoie(p.parents("point").first().children("texte").first().text()) || null;
    const orateur = nettoie(p.find("orateurs > orateur > nom").first().text()) || null;
    const qualite = nettoie(p.find("orateurs > orateur > qualite").first().text()) || null;
    if (courante && courante.acteur_ref === acteur && courante.point === point) { courante.texte += `\n${texte}`; return; }
    courante = { id: p.attr("id_syceron") || `${uid}-${out.length}`, seance_uid: uid, chambre: "AN", date_seance: date, point, acteur_ref: acteur, orateur, qualite, texte, ordre: Number(p.attr("ordre_absolu_seance") || out.length) };
    out.push(courante);
  });
  return { uid, date, etat, interventions: out };
}

async function main() {
  const local = process.argv.find(a => a.startsWith("--fichier="))?.split("=").slice(1).join("=");
  let archive: Buffer;
  if (local) archive = fs.readFileSync(local);
  else {
    console.log("[Débats AN] Téléchargement des comptes rendus…");
    const r = await fetch(SOURCE, { signal: AbortSignal.timeout(15 * 60000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    archive = Buffer.from(await r.arrayBuffer());
  }
  const zip = new AdmZip(archive);
  const fichiers = zip.getEntries().filter(e => /CRSANR5L\d+S.*\.xml$/.test(e.entryName));
  const connues = new Map<string, string>();
  if (!TOUT) {
    for (let de = 0; ; de += 1000) {
      const { data, error } = await supabase.from("seances_comptes_rendus").select("uid, empreinte").range(de, de + 999);
      if (error) { if (DRY) break; throw error; }
      for (const s of data || []) connues.set(s.uid, s.empreinte);
      if (!data || data.length < 1000) break;
    }
  }
  let relues = 0, interventions = 0, octets = 0;
  for (const f of fichiers) {
    const xml = f.getData().toString("utf8");
    const empreinte = crypto.createHash("md5").update(xml).digest("hex");
    const uid = f.entryName.match(/(CRSANR5L\d+S[^/]+)\.xml$/)?.[1] || "";
    if (!TOUT && connues.get(uid) === empreinte) continue;
    const s = lireSeance(xml);
    relues++; interventions += s.interventions.length; octets += s.interventions.reduce((t, i) => t + i.texte.length, 0);
    if (DRY) continue;
    // La séance d'abord (les interventions s'y rattachent), puis ses interventions remplacées d'un
    // bloc : le provisoire devient définitif, des paragraphes changent. L'empreinte n'est écrite
    // qu'à la fin : une séance interrompue en cours d'écriture sera relue au passage suivant.
    const { error: e0 } = await supabase.from("seances_comptes_rendus").upsert({ uid: s.uid, chambre: "AN", date_seance: s.date, etat: s.etat, empreinte: null, maj_le: new Date().toISOString(),
      url: `https://www.assemblee-nationale.fr/dyn/17/comptes-rendus/seance/${s.uid}` }, { onConflict: "uid" });
    if (e0) throw e0;
    const { error: e1 } = await supabase.from("seance_interventions").delete().eq("seance_uid", s.uid);
    if (e1) throw e1;
    for (let i = 0; i < s.interventions.length; i += 500) {
      const { error } = await supabase.from("seance_interventions").upsert(s.interventions.slice(i, i + 500), { onConflict: "id" });
      if (error) throw error;
    }
    const { error: e2 } = await supabase.from("seances_comptes_rendus").update({ empreinte }).eq("uid", s.uid);
    if (e2) throw e2;
  }
  console.log(`[Débats AN] ${fichiers.length} séance(s) publiée(s), ${relues} relue(s) : ${interventions} intervention(s), ${(octets / 1e6).toFixed(1)} Mo de texte${DRY ? " — ESSAI, rien d'écrit" : ""}.`);
}

if (process.argv[1]?.endsWith("sync-debats-an.ts")) main().catch(e => { console.error(e); process.exitCode = 1; });
