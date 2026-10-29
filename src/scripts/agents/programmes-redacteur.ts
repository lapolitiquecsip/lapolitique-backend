import "dotenv/config";
import * as cheerio from "cheerio";
import { enAttente, signaler, echec, type Item } from "../../lib/cycles.js";
import { extractIdeas, NOISE } from "../data/sync-candidate-proposals.js";
import { lirePageOfficielle, estRefus } from "../../lib/lecture-officielle.js";

/**
 * CYCLE PROGRAMMES — agent 2 : le rédacteur.
 *
 * Sa seule tâche : prendre une page que le veilleur vient de détecter, la lire en entier, et
 * en tirer un BROUILLON au format des fiches (thèmes, contexte par thème, propositions).
 * Il ne publie rien : le brouillon est posé dans le journal, à l'étape « redige », avec le
 * texte source à côté. C'est le vérificateur qui décidera s'il est fidèle.
 *
 * La consigne de rédaction est EXACTEMENT celle qui a produit la fiche de David Lisnard
 * (extractIdeas, dans sync-candidate-proposals) : même ton, même grain, aucune invention.
 * La seule différence est que la page est lue jusqu'au bout — un plan thématique de
 * quarante pages ne tient pas dans les 9 000 caractères d'une page de site ordinaire. Elle
 * est donc découpée par section, et chaque section est rédigée à part.
 *
 * Ne traite que la filière « agents » : les sites relevés chaque semaine par la tâche
 * existante ne doivent pas être rédigés deux fois.
 *
 * Usage : npx tsx src/scripts/agents/programmes-redacteur.ts [--max=2] [--url=https://… (essai, rien n'est écrit)]
 */
const AGENT = "programmes-redacteur";
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const MAX = Number(arg("max") || 2);
const URL_ESSAI = arg("url");
const TAILLE_SECTION = 8000;

export type Brouillon = { theme: string; contexte: string | null; propositions: string[] }[];

/** La page, découpée en sections : chaque intertitre (niveaux 2 à 4) ouvre un thème. */
export async function lireSections(url: string): Promise<{ titre: string; sections: { theme: string; texte: string }[]; texte: string }> {
  const lue = await lirePageOfficielle(url);
  if (lue.texte !== undefined) return sectionsDuTexte(lue.texte);
  const $ = cheerio.load(lue.html);
  $("nav, header, footer, script, style, form, aside").remove();
  const titre = $("h1").first().text().replace(/\s+/g, " ").trim().slice(0, 120);
  const sections: { theme: string; texte: string }[] = [];
  let courante = { theme: titre, texte: "" };
  $("h2, h3, h4, p, li, tr").each((_, el) => {
    let tag = (el as any).tagName as string;
    // Un tableau de chiffrage se lit ligne par ligne, cellules séparées : sans cela, les
    // montants d'un plan d'investissement n'existeraient pas dans le texte source.
    if (tag !== "tr" && $(el).closest("table").length) return;
    const brut = tag === "tr"
      ? $(el).find("th, td").map((_, c) => $(c).text().trim()).get().filter(Boolean).join(" : ")
      : $(el).text();
    if (tag === "tr") tag = "p";
    const t = brut.replace(/\s+/g, " ").replace(/[↓↑→]/g, "").trim();
    if (!t || t.length < 8 || NOISE.test(t)) return;
    // Un <li> qui contient des <p> serait lu deux fois.
    if (tag === "li" && $(el).find("p, li").length) return;
    if (tag !== "p" && tag !== "li") {
      const intitule = t.replace(/^\s*(?:[IVX]+\.|\d+(?:\.\d+)*\.?)\s+/, "").slice(0, 160);
      // Un intertitre ouvre un thème — sauf si le précédent n'a presque rien dit : un titre
      // suivi d'un sous-titre forme un seul thème, pas un thème vide puis un autre.
      if (!courante.texte.trim()) { courante.theme = intitule; return; }
      if (courante.texte.length < 300) { courante.texte += `\n## ${t}\n`; return; }
      sections.push(courante);
      courante = { theme: intitule, texte: "" };
      return;
    }
    courante.texte += `${t}\n`;
  });
  if (courante.texte.trim()) sections.push(courante);
  return { titre, sections, texte: sections.map(x => `# ${x.theme}\n${x.texte}`).join("\n") };
}

/**
 * Même découpage, pour une page lue par la voie de secours (texte, intertitres en « # »).
 * Sans intertitre reconnu, la page forme une seule section, que `morceaux` coupera.
 */
function sectionsDuTexte(brut: string): { titre: string; sections: { theme: string; texte: string }[]; texte: string } {
  const lignes = brut.split("\n").map(l => l.replace(/\s+/g, " ").replace(/[↓↑→]/g, "").trim()).filter(Boolean);
  const titre = (lignes.find(l => /^#\s/.test(l)) ?? lignes[0] ?? "").replace(/^#+\s*/, "").slice(0, 120);
  const sections: { theme: string; texte: string }[] = [];
  let courante = { theme: titre, texte: "" };
  for (const l of lignes) {
    const h = l.match(/^#{1,4}\s+(.+)/);
    if (h) {
      const intitule = h[1].replace(/[*_]/g, "").replace(/^\s*(?:[IVX]+\.|\d+(?:\.\d+)*\.?)\s+/, "").slice(0, 160);
      if (!courante.texte.trim()) { courante.theme = intitule; continue; }
      if (courante.texte.length < 300) { courante.texte += `\n## ${intitule}\n`; continue; }
      sections.push(courante);
      courante = { theme: intitule, texte: "" };
      continue;
    }
    // Liens Markdown réduits à leur texte ; menus et mentions répétées écartés comme en HTML.
    const t = l.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^[-*]\s+/, "").replace(/\*\*/g, "").trim();
    if (t.length < 8 || NOISE.test(t)) continue;
    courante.texte += `${t}\n`;
  }
  if (courante.texte.trim()) sections.push(courante);
  return { titre, sections, texte: sections.map(x => `# ${x.theme}\n${x.texte}`).join("\n") };
}

/** Coupe une section longue aux fins de paragraphe, jamais au milieu d'une phrase. */
function morceaux(texte: string): string[] {
  const out: string[] = [];
  let bloc = "";
  for (const ligne of texte.split("\n")) {
    if (bloc.length + ligne.length > TAILLE_SECTION && bloc) { out.push(bloc); bloc = ""; }
    bloc += ligne + "\n";
  }
  if (bloc.trim()) out.push(bloc);
  return out;
}

/**
 * Rédige la page section par section.
 *
 * `deja` reprend les sections rédigées lors d'un passage interrompu : quand le quota du
 * modèle tombe au milieu d'un plan de vingt sections, on ne recommence pas les dix premières.
 */
export async function rediger(url: string, deja: Brouillon = []): Promise<{ titre: string; brouillon: Brouillon; texte: string; complet: boolean; erreur?: string }> {
  const { titre, sections, texte } = await lireSections(url);
  if (texte.length < 600) throw new Error("page sans texte exploitable (PDF à télécharger, page animée ?)");
  const brouillon: Brouillon = [...deja];
  for (let i = deja.length; i < sections.length; i++) {
    const s = sections[i];
    let contexte: string | null = null;
    const propositions: string[] = [];
    try {
      for (const m of morceaux(s.texte)) {
        const r = await extractIdeas(s.theme, m);
        contexte = contexte ?? r.context;
        propositions.push(...r.proposals);
        await new Promise(x => setTimeout(x, 400));
      }
    } catch (e: any) {
      return { titre, brouillon, texte, complet: false, erreur: `section ${i + 1}/${sections.length} : ${e?.message ?? e}` };
    }
    // Une section sans proposition (diagnostic, sommaire) garde sa place, vide : c'est le
    // rang dans la page qui dit où reprendre.
    brouillon.push({ theme: s.theme, contexte, propositions: [...new Set(propositions)] });
  }
  return { titre, brouillon, texte, complet: true };
}

async function main() {
  if (URL_ESSAI) {
    const { titre, brouillon, complet, erreur } = await rediger(URL_ESSAI);
    console.log(`\n${titre}${complet ? "" : `  [INTERROMPU : ${erreur}]`}\n`);
    for (const t of brouillon.filter(x => x.propositions.length)) {
      console.log(`■ ${t.theme} (${t.propositions.length})\n  contexte : ${t.contexte ?? "—"}`);
      for (const p of t.propositions) console.log(`  - ${p}`);
    }
    console.log(`\n(essai : ${brouillon.reduce((n, t) => n + t.propositions.length, 0)} propositions, rien n'est écrit)`);
    return;
  }

  console.log("=== Programmes · rédacteur ===");
  const file = (await enAttente("programmes", "detecte", 50))
    // Un refus du site (403, panne) se retente dix jours (deux passages par jour) : c'était la
    // limite de quatre essais qui avait figé le plan « Automobile » en octobre 2026.
    .filter((i: Item) => i.donnees?.filiere === "agents" && i.source_url && i.tentatives < (estRefus(i.erreur) ? 20 : 4))
    .slice(0, MAX);
  if (!file.length) { console.log("  Rien à rédiger."); return; }

  for (const item of file) {
    try {
      const r = await rediger(item.source_url!, item.donnees?.partiel ?? []);
      if (!r.complet) {
        // On garde ce qui est fait ; le prochain passage reprendra à la section suivante.
        await signaler(AGENT, item, { cycle: "programmes", cle: item.cle, etape: "detecte", donnees: { partiel: r.brouillon } });
        throw new Error(`interrompu, ${r.brouillon.length} section(s) gardée(s) — ${r.erreur}`);
      }
      const brouillon = r.brouillon.filter(t => t.propositions.length);
      const texte = r.texte;
      const n = brouillon.reduce((s, t) => s + t.propositions.length, 0);
      if (!n) throw new Error("aucune proposition extraite");
      await signaler(AGENT, item, {
        cycle: "programmes", cle: item.cle, etape: "redige",
        donnees: { brouillon, partiel: null, texte: texte.slice(0, 200000), redige_le: new Date().toISOString() },
      });
      console.log(`  ✓ ${item.sujet} · ${item.titre ?? item.cle} : ${n} proposition(s) en ${brouillon.length} thème(s)`);
    } catch (e: any) {
      await echec(AGENT, item, e.message);
      console.warn(`  ! ${item.cle} : ${e.message}`);
    }
  }
}

if (process.argv[1]?.endsWith("programmes-redacteur.ts")) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
