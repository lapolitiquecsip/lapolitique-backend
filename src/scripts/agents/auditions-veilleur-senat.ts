import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { lireCycle, signaler } from "../../lib/cycles.js";

/**
 * CYCLE AUDITIONS — veilleur du Sénat.
 *
 * Même tâche que le veilleur de l'Assemblée, pour le Sénat : tenir la liste de ce qui a été
 * publié et la confronter à ce qui est en ligne pour l'abonné Pro.
 *
 * Le Sénat ne publie pas d'agenda en open data : la référence, ce sont ses pages d'index par
 * commission, qui renvoient vers une page par commission et par semaine contenant plusieurs
 * réunions. L'objet suivi est donc la PAGE HEBDOMADAIRE, et le veilleur compte :
 *
 *   - les réunions que la page contient (un titre de niveau 3 suivi d'un vrai verbatim) ;
 *   - celles qui sont en base, et parmi elles celles qui ont leur analyse.
 *
 * Ce comptage attrape un trou que la collecte ne voyait pas : elle saute toute page déjà
 * connue, or le Sénat complète parfois une page après sa première mise en ligne. Les
 * réunions ajoutées ensuite n'étaient jamais reprises.
 *
 *   en_ligne   toutes les réunions de la page sont analysées
 *   collecte   toutes en base, analyses en cours
 *   detecte    page absente de la base, ou complétée depuis (le motif donne les nombres)
 *
 * Usage : npx tsx src/scripts/agents/auditions-veilleur-senat.ts [--semaines=10] [--dry-run]
 */
const AGENT = "auditions-veilleur-senat";
const SENAT = "https://www.senat.fr";
const SEMAINES = Number(process.argv.find(a => a.startsWith("--semaines="))?.split("=")[1] || 10);
const DRY = process.argv.includes("--dry-run");
const UA = { "User-Agent": "Mozilla/5.0 (compatible; lapolitiquecestsimple/1.0; +https://lapolitiquecestsimple.fr)" };

/** Les mêmes index que la collecte (scripts/update-commissions.ts, dépôt du site). */
const INDEX: { page: string; commission: string }[] = [
  { page: "lois", commission: "Commission des lois" },
  { page: "finances", commission: "Commission des finances" },
  { page: "economie", commission: "Commission des affaires économiques" },
  { page: "culture", commission: "Commission de la culture, de l'éducation et de la communication" },
  { page: "affaires-sociales", commission: "Commission des affaires sociales" },
  { page: "developpement-durable", commission: "Commission de l'aménagement du territoire et du développement durable" },
  { page: "affaires-etrangeres", commission: "Commission des affaires étrangères, de la défense et des forces armées" },
  { page: "affaires-europeennes", commission: "Commission des affaires européennes" },
];

async function lire(url: string): Promise<string | null> {
  for (let essai = 0; essai < 2; essai++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.text();
      if (r.status < 500) return null;
    } catch { /* on réessaie */ }
    await new Promise(x => setTimeout(x, 3000));
  }
  return null;
}

/**
 * Nombre de réunions d'une page hebdomadaire, comptées comme la collecte les découpe :
 * un titre h3 placé sous une date (h2), suivi d'au moins 400 caractères de texte.
 */
function compterReunions(html: string): number {
  const debut = html.search(/<h1/i);
  if (debut < 0) return 0;
  const corps = html.slice(debut).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const reperes = [...corps.matchAll(/<(h[23])[^>]*>[\s\S]*?<\/\1>/gi)].map(m => ({
    niveau: m[1].toLowerCase(), debut: m.index!, fin: m.index! + m[0].length,
  }));
  let n = 0, date = false;
  for (let i = 0; i < reperes.length; i++) {
    if (reperes[i].niveau === "h2") { date = true; continue; }
    if (!date) continue;
    const texte = corps.slice(reperes[i].fin, reperes[i + 1]?.debut ?? corps.length).replace(/<[^>]+>/g, " ")
      // Une entité HTML compte pour un caractère, comme dans le texte décodé de la collecte.
      .replace(/&#?[a-z0-9]+;/gi, "x").replace(/\s+/g, " ").trim();
    // Marge de 15 % : les deux découpages ne nettoient pas le texte à l'identique, et une
    // entrée de quelques lignes (désignation d'un rapporteur) ne doit pas passer pour un oubli.
    if (texte.length >= 460) n++;
  }
  return n;
}

async function main() {
  console.log(`=== Auditions · veilleur du Sénat${DRY ? " (essai, rien n'est écrit)" : ""} ===`);
  const limite = new Date(Date.now() - SEMAINES * 7 * 864e5).toISOString().slice(0, 10).replace(/-/g, "");

  const pages = new Map<string, { commission: string; semaine: string }>();
  for (const { page, commission } of INDEX) {
    const html = await lire(`${SENAT}/compte-rendu-commissions/${page}.html`);
    if (!html) { console.warn(`  ! index ${page} inaccessible`); continue; }
    for (const m of html.matchAll(/href="(\/compte-rendu-commissions\/(\d{8})\/[a-z0-9_-]+\.html)"/gi)) {
      if (m[2] >= limite) pages.set(`${SENAT}${m[1]}`, { commission, semaine: m[2] });
    }
    await new Promise(x => setTimeout(x, 300));
  }
  console.log(`  ${pages.size} page(s) hebdomadaire(s) publiée(s) depuis ${SEMAINES} semaines`);

  const { data: lignes, error } = await supabase.from("commission_reports")
    .select("cr_url, analyzed_at").eq("chamber", "SENAT").limit(5000);
  if (error) throw error;
  const enBase = new Map<string, { total: number; analysees: number }>();
  for (const l of lignes ?? []) {
    const e = enBase.get(l.cr_url) ?? { total: 0, analysees: 0 };
    e.total++; if (l.analyzed_at) e.analysees++;
    enBase.set(l.cr_url, e);
  }

  const suivi = await lireCycle("auditions");
  const compte: Record<string, number> = {};
  for (const [url, { commission, semaine }] of pages) {
    const html = await lire(url);
    await new Promise(x => setTimeout(x, 400));
    if (!html) { console.warn(`  ! ${url} inaccessible`); continue; }
    const publiees = compterReunions(html);
    const base = enBase.get(url) ?? { total: 0, analysees: 0 };

    let etape: string, erreur: string | null = null;
    if (!publiees) continue;                                  // page d'annonce sans compte rendu
    if (base.total < publiees) {
      etape = "detecte";
      erreur = base.total
        ? `Page complétée par le Sénat après sa collecte : ${publiees} réunions publiées, ${base.total} en base.`
        : `Page pas encore collectée (${publiees} réunions).`;
    } else etape = base.analysees >= base.total ? "en_ligne" : "collecte";
    compte[etape] = (compte[etape] || 0) + 1;
    if (etape !== "en_ligne") console.log(`  ${etape} · ${url.split("/").slice(-2).join("/")} — ${erreur ?? `${base.analysees}/${base.total} analysées`}`);
    if (DRY) continue;
    await signaler(AGENT, suivi.get(url), {
      cycle: "auditions", cle: url, etape, erreur, sujet: `Sénat · ${commission}`,
      titre: `Semaine du ${semaine.slice(6)}/${semaine.slice(4, 6)}/${semaine.slice(0, 4)} — ${publiees} réunion(s)`,
      source_url: url, date_objet: `${semaine.slice(0, 4)}-${semaine.slice(4, 6)}-${semaine.slice(6)}`,
      // `ref` sert de marqueur « publiable » au contrôleur, comme pour l'Assemblée.
      donnees: { chambre: "SENAT", ref: url, publiees, en_base: base.total, analysees: base.analysees },
    });
  }
  for (const [e, n] of Object.entries(compte).sort((a, b) => b[1] - a[1])) console.log(`    ${e.padEnd(10)} ${n}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
