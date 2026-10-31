import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { supabase } from "../../config/supabase.js";
import { carrouselChiffre, visuelBrief, type Slide } from "../../lib/visuels/gabarits.js";
import { carrouselIdee } from "../../lib/visuels/idee.js";
import { DOSSIER_ASSETS, rendreSlides } from "../../lib/visuels/rendu.js";
import { notion, notionActif, texteRiche } from "../../lib/notion.js";

/**
 * Prépare les posts du jour : la meilleure idée récente (table veille_posts) devient un carrousel
 * et un texte, déposés dans Notion Publications au statut « À valider ». Rien ne part d'ici :
 * publier-publications.ts n'envoie que ce qui a été passé à « Validé » à la main.
 *
 * Les controverses d'élus sont exclues d'office. Le texte vient du brouillon de la veille, déjà limité
 * aux faits du site ; les chiffres officiels sont relus depuis la base sans passer par une IA.
 * `--essai` rend les visuels en local et affiche le choix, sans rien écrire. `--sortie=dossier` pour les garder.
 */
const ESSAI = process.argv.includes("--essai");
const SORTIE = process.argv.find(a => a.startsWith("--sortie="))?.split("=")[1];
const PAR_JOUR = Number(process.env.PUBLICATIONS_PAR_JOUR ?? 1);
const BASE = process.env.NOTION_PUBLICATIONS_ID ?? "2a521d9901334926805216c885ac0499";
const BUCKET = "publications";
const EXCLUS = new Set(["controverse", "suivi", "debat"]);
const PALETTE_TYPE: Record<string, "cobalt" | "rose" | "vert"> = { indicateur: "cobalt", loi: "vert", texte: "vert", programme: "rose", candidat: "rose", fil: "cobalt", petition: "rose", sondage: "cobalt" };

const reference = (cle: string) => `ref:${createHash("md5").update(cle).digest("hex").slice(0, 16)}`;

/** « Croissance du PIB : -0.1 % (T3 2026) » et « Valeur précédente publiée : 0 % (T2 2026) », lus tels quels. */
function chiffreDepuisIdee(idee: any) {
  const t = /^(.+?) : (-?[\d.,]+) ?(.*?) \((.+)\)$/.exec(idee.titre);
  if (!t) return null;
  const [, libelle, valeur, unite, periode] = t;
  const prec = /Valeur précédente publiée : (-?[\d.,]+) ?(.*?) \((.+?)\)/.exec(idee.faits ?? "");
  const nombre = (v: string) => {
    const n = Number(v);
    return (Number.isInteger(n) && Math.abs(n) >= 1000 ? n.toLocaleString("fr-FR") : v.replace(".", ",")).replace("-", "−");
  };
  const val = `${nombre(valeur)}${unite ? ` ${unite}` : ""}`;
  return {
    libelle, val, periode,
    source: idee.source.replace(/^Chiffre officiel · /, ""),
    comparaison: [...(prec ? [{ periode: prec[3], valeur: `${nombre(prec[1])}${prec[2] ? ` ${prec[2]}` : ""}` }] : []), { periode, valeur: val }],
  };
}

function visuels(idee: any, type: string): Slide[] {
  const b = idee.brief;
  const palette = PALETTE_TYPE[type] ?? "rose";
  const c = type === "indicateur" ? chiffreDepuisIdee(idee) : null;
  if (c) {
    return [
      ...carrouselChiffre({
        rubrique: "Chiffre officiel", accroche: c.libelle, valeur: c.val, sousTitre: `${c.periode} · Source : ${c.source}`,
        comparaison: c.comparaison, explications: (b.faits_cles ?? []).slice(0, 2), source: c.source, lienSource: idee.url, palette,
      }, DOSSIER_ASSETS),
      visuelBrief({ titre: c.libelle, sousTitre: `${c.periode} · Source : ${c.source}`, colonnes: c.comparaison.slice(-2).map(x => ({ valeur: x.valeur, texte: x.periode })), palette }),
    ];
  }
  const points: string[] = (b.faits_cles ?? []).slice(0, 6);
  if (!b.accroche || !points.length) throw new Error("brouillon incomplet");
  return carrouselIdee({
    rubrique: idee.source.split("·")[0].replace(/\(.*\)/, "").trim().slice(0, 30),
    accroche: b.accroche, points, source: new URL(idee.url).hostname.replace(/^www\./, ""), palette,
  }, DOSSIER_ASSETS);
}

async function dejaProposee(cle: string) {
  const r = await notion(`databases/${BASE}/query`, { page_size: 1, filter: { property: "Sources", rich_text: { contains: reference(cle) } } });
  return r.results.length > 0;
}

async function deposer(idee: any, fichiers: string[]) {
  await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => null);
  const urls: { name: string; external: { url: string } }[] = [];
  const dossier = `${new Date().toISOString().slice(0, 10)}/${reference(idee.cle).slice(4)}`;
  for (const f of fichiers) {
    const nom = `${dossier}/${basename(f)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(nom, readFileSync(f), { contentType: "image/png", upsert: true });
    if (error) throw new Error(`Stockage : ${error.message}`);
    urls.push({ name: basename(f), external: { url: supabase.storage.from(BUCKET).getPublicUrl(nom).data.publicUrl } });
  }
  const b = idee.brief;
  const legende = [b.instagram?.legende, (b.instagram?.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
  const linkedin = [b.linkedin?.texte, (b.linkedin?.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
  const alertes = [...(idee.chiffres_a_verifier ?? []).map((c: string) => `Chiffre absent des faits, à vérifier : ${c}`), ...(b.prudence ?? [])];
  const sources = [idee.source, idee.url, idee.faits, alertes.length ? `À VÉRIFIER :\n- ${alertes.join("\n- ")}` : "", reference(idee.cle)].filter(Boolean).join("\n\n");
  const page = await notion("pages", {
    parent: { database_id: BASE },
    properties: {
      Sujet: { title: texteRiche((b.accroche ?? idee.titre).slice(0, 200)) },
      Statut: { select: { name: "À valider" } },
      Projet: { select: { name: "LPCS" } },
      Sources: { rich_text: texteRiche(sources) },
      "Texte LinkedIn": { rich_text: texteRiche(linkedin) },
      "Légende Instagram": { rich_text: texteRiche(legende) },
      Visuel: { files: urls },
    },
  });
  return page.url as string;
}

async function main() {
  if (!ESSAI && !notionActif()) {
    console.log("::notice::NOTION_API_KEY absente : préparation en attente.");
    return;
  }
  const depuis = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase.from("veille_posts")
    .select("cle,source,titre,url,faits,importance,brief,chiffres_a_verifier,jour,detecte_le")
    .eq("statut", "pret").gte("jour", depuis).not("brief", "is", null).not("url", "is", null)
    .order("importance", { ascending: false }).order("detecte_le", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);

  let faits = 0;
  const sourcesVues = new Set<string>();
  for (const idee of data ?? []) {
    if (faits >= PAR_JOUR) break;
    const type = idee.cle.split(":")[0];
    if (EXCLUS.has(type) || sourcesVues.has(idee.source)) continue;
    sourcesVues.add(idee.source);
    if (!ESSAI && await dejaProposee(idee.cle)) continue;
    try {
      const sortie = SORTIE ? join(SORTIE, reference(idee.cle).slice(4)) : join(tmpdir(), `publication-${Date.now()}`);
      const fichiers = await rendreSlides(visuels(idee, type), sortie, ESSAI ? { channel: "chrome" } : {});
      if (ESSAI) console.log(`[essai] ${idee.cle}\n  ${idee.brief.accroche}\n  ${fichiers.length} visuels dans ${sortie}`);
      else console.log(`Déposé : ${idee.titre} → ${await deposer(idee, fichiers)}`);
      faits++;
    } catch (e) {
      console.log(`::warning::Idée écartée (${idee.cle}) : ${(e as Error).message}`);
    }
  }
  if (!faits) console.log("::notice::Aucune nouvelle idée à proposer.");
}

main().then(() => process.exit(0)).catch(e => { console.log(`::error::${String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 500)}`); process.exit(1); });
