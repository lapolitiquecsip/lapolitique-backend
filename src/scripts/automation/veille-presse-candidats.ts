import "dotenv/config";
import Parser from "rss-parser";
import { supabase } from "../../config/supabase.js";
import { PANEL_PRESSE } from "../../lib/panel-presse.js";

/**
 * Veille presse des candidats à la présidentielle : combien d'articles les citent.
 *
 * Méthode des outils de veille professionnels : un PANEL FIXE de médias (presse
 * nationale, régionale, radio-télé), relu toutes les deux heures. Chaque article
 * qui nomme un candidat dans son titre ou son chapeau est conservé (adresse, média,
 * date) : les chiffres affichés sont des articles identifiés, vérifiables un par
 * un, et comparables d'un jour à l'autre parce que le panel ne change pas.
 *
 * Un candidat est reconnu par son nom complet, ou par son seul nom de famille
 * quand il est sans ambiguïté (« Mélenchon », pas « Philippe » ni « Royal »).
 */

// Le panel est partagé avec la veille des annonces du gouvernement (executif-annonces.ts).
const PANEL = PANEL_PRESSE;

// Noms de famille qui sont aussi des prénoms ou des mots courants : il faut le nom complet.
const AMBIGUS = new Set(["philippe", "royal", "faure", "bertrand", "hollande", "brun", "roussel", "batho", "kazib", "labib", "massard", "arthaud", "maurel"]);
const MAX_AGE_JOURS = Number(process.env.VEILLE_PRESSE_JOURS || 4);

const parser = new Parser({ timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 (compatible; lapolitiquecestsimple-veille)" } });
const norm = (s: string) => ` ${(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

async function main() {
  const { data: cands, error } = await supabase.from("presidential_candidates").select("slug, full_name").eq("status", "declared");
  if (error) throw error;
  const motifs = (cands || []).map(c => {
    const complet = norm(c.full_name);
    const nom = complet.trim().split(" ").slice(-1)[0];
    // « Le Pen », « Dupont-Aignan » : nom de famille en plusieurs mots.
    const famille = /le pen/.test(complet) ? " le pen " : /dupont aignan/.test(complet) ? " dupont aignan " : ` ${nom} `;
    return { slug: c.slug, cles: AMBIGUS.has(famille.trim()) ? [complet] : [complet, famille] };
  });

  const limite = Date.now() - MAX_AGE_JOURS * 86400000;
  const lignes: any[] = []; let flux = 0, lus = 0, ko: string[] = [];
  for (const [media, urls] of Object.entries(PANEL)) {
    let ok = false;
    for (const u of urls) {
      let f;
      try { f = await parser.parseURL(u); } catch { continue; }
      ok = true; flux++;
      for (const it of f.items || []) {
        lus++;
        const url = (it.link || "").split("?")[0].split("#")[0];
        if (!url) continue;
        const date = it.isoDate ? new Date(it.isoDate) : new Date();
        if (date.getTime() < limite || date.getTime() > Date.now() + 3600000) continue;
        const texte = norm(`${it.title || ""} ${it.contentSnippet || it.summary || ""}`.slice(0, 600));
        const candidats = motifs.filter(m => m.cles.some(k => texte.includes(k))).map(m => m.slug);
        if (!candidats.length) continue;
        lignes.push({ url, titre: (it.title || "").trim().slice(0, 400), media, publie_le: date.toISOString(), candidats });
      }
    }
    if (!ok) ko.push(media);
  }
  const uniques = [...new Map(lignes.map(l => [l.url, l])).values()];
  // Un article déjà connu n'est pas réécrit : sa date de première lecture fait foi.
  for (let i = 0; i < uniques.length; i += 300) {
    const { error: e } = await supabase.from("media_articles").upsert(uniques.slice(i, i + 300), { onConflict: "url", ignoreDuplicates: true });
    if (e) throw e;
  }
  console.log(`[Veille presse] ${flux} flux lus (${Object.keys(PANEL).length - ko.length}/${Object.keys(PANEL).length} médias), ${lus} articles parcourus, ${uniques.length} citent un candidat.`);
  if (ko.length > 6) console.log(`::warning::${ko.length} médias du panel injoignables : ${ko.join(", ")}`);
  else if (ko.length) console.log(`[Veille presse] Injoignables ce passage : ${ko.join(", ")}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
