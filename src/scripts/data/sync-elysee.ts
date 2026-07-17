import "dotenv/config";
import crypto from "crypto";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";

// Publications de la présidence de la République — source officielle elysee.fr.
//   1) le flux RSS officiel (https://www.elysee.fr/feed)
//   2) la rubrique « Conseil des ministres », car le flux n'en remonte que les 1-2 derniers.
// Aucun contenu n'est inventé : on stocke le titre, la date et le lien tels que publiés.
const RSS = "https://www.elysee.fr/feed";
const CDM_PAGE = "https://www.elysee.fr/actualites/conseil-des-ministres";
const UA = "Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)";

type Pub = { id: string; type: string; title: string; url: string; published_at: string | null; summary: string | null };

const hash = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 32);

async function fetchText(url: string, tries = 3): Promise<string> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return "";
}

// Le flux ne porte aucune catégorie : on classe sur l'intitulé officiel, qui est très normé.
export function classify(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("conseil des ministres")) return "conseil_ministres";
  if (/^d[ée]placement|visite d'[ée]tat|visite d’[ée]tat|^sommet|^visite|comm[ée]moration/.test(t)) return "deplacement";
  // Strictement les prises de parole : une commémoration ou un hommage est un
  // déplacement/événement, pas un discours — mieux vaut ne pas sur-classer.
  if (/d[ée]claration|discours|allocution|adresse aux fran|entretien|interview/.test(t)) return "discours";
  return "actualite";
}

function parseRss(xml: string): Pub[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: Pub[] = [];
  $("item").each((_, el) => {
    const title = ($(el).find("title").first().text() || "").trim();
    const url = ($(el).find("link").first().text() || "").trim();
    const pub = ($(el).find("pubDate").first().text() || "").trim();
    const desc = ($(el).find("description").first().text() || "").trim();
    if (!title || !url) return;
    const d = pub ? new Date(pub) : null;
    out.push({
      id: hash(url),
      type: classify(title),
      title,
      url,
      published_at: d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null,
      summary: desc ? desc.replace(/<[^>]+>/g, "").trim().slice(0, 500) || null : null,
    });
  });
  return out;
}

// Rubrique Conseil des ministres : on récupère les comptes rendus (le flux est trop court).
// La date est portée par l'URL (/emmanuel-macron/AAAA/MM/JJ/...), donc fiable.
function parseConseils(html: string): Pub[] {
  const out = new Map<string, Pub>();
  const re = /\/emmanuel-macron\/(\d{4})\/(\d{2})\/(\d{2})\/([a-z0-9-]*compte-rendu-du-conseil-des-ministres[a-z0-9-]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [path, y, mo, d, slug] = [m[0], m[1], m[2], m[3], m[4]];
    const url = `https://www.elysee.fr${path}`;
    // Titre lisible reconstruit depuis le slug officiel.
    const title = slug.replace(/-/g, " ").replace(/^./, c => c.toUpperCase());
    out.set(url, { id: hash(url), type: "conseil_ministres", title, url, published_at: `${y}-${mo}-${d}`, summary: null });
  }
  return [...out.values()];
}

export async function syncElysee() {
  console.log("--- SYNC ELYSEE (elysee.fr) ---");
  const [xml, cdmHtml] = await Promise.all([fetchText(RSS), fetchText(CDM_PAGE).catch(() => "")]);

  const fromRss = parseRss(xml);
  console.log(`> RSS : ${fromRss.length} publications.`);
  const fromCdm = cdmHtml ? parseConseils(cdmHtml) : [];
  console.log(`> Rubrique Conseil des ministres : ${fromCdm.length} comptes rendus.`);

  // Le RSS a la priorité (titre officiel complet) ; la rubrique complète l'historique.
  const byId = new Map<string, Pub>();
  for (const p of fromCdm) byId.set(p.id, p);
  for (const p of fromRss) byId.set(p.id, p);
  const rows = [...byId.values()].map(p => ({ ...p, updated_at: new Date().toISOString() }));

  const counts = rows.reduce((a: Record<string, number>, r) => ((a[r.type] = (a[r.type] || 0) + 1), a), {});
  console.log("> Répartition :", counts);

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("elysee_publications").upsert(rows.slice(i, i + 200), { onConflict: "id" });
    if (error) { console.error("[Elysee] upsert:", error.message); throw error; }
  }
  console.log(`--- TERMINE. ${rows.length} publications. ---`);
  return rows.length;
}

if (process.argv[1] && process.argv[1].endsWith("sync-elysee.ts")) {
  syncElysee().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
