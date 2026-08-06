// Récupère l'EXPOSÉ DES MOTIFS d'un dossier législatif (le texte qui explique CE QUE contient
// le texte et à QUEL problème il répond) — introuvable dans les métadonnées, mais présent dans
// le PDF officiel du texte (Assemblée nationale et Sénat). Source = documents officiels, aucune
// invention. Retourne le texte nettoyé (borné) ou null si indisponible.
import pdf from "pdf-parse/lib/pdf-parse.js";

const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
const MAX_CHARS = 9000;

async function fetchText(url: string, timeout = 20000): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout), redirect: "follow" });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

async function pdfText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000), redirect: "follow" });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (!/pdf/i.test(ct)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const d = await pdf(buf);
    return d.text || null;
  } catch { return null; }
}

// À partir d'une URL source de dossier, déduit l'URL du PDF du texte déposé.
async function pdfUrlsFromSource(src: string): Promise<string[]> {
  // Assemblée : page "textes" directe → +.pdf
  const anTextes = src.match(/https?:\/\/www\.assemblee-nationale\.fr\/dyn\/\d+\/textes\/l\d+b[\w-]+/i);
  if (anTextes) return [anTextes[0] + ".pdf"];

  // Assemblée : page "dossiers" → suivre vers le 1er lien de texte, puis +.pdf
  if (/assemblee-nationale\.fr\/dyn\/\d+\/dossiers\//i.test(src)) {
    const html = await fetchText(src);
    if (html) {
      const m = html.match(/https?:\/\/www\.assemblee-nationale\.fr\/dyn\/\d+\/textes\/l\d+b[\w-]+/i);
      if (m) return [m[0] + ".pdf"];
    }
    return [];
  }

  // Sénat : page de dossier (statique) → 1er PDF de texte (/leg/…pjl|ppl…pdf)
  if (/senat\.fr\//i.test(src)) {
    const html = await fetchText(src);
    if (html) {
      const links = [...html.matchAll(/href="([^"]+\.pdf)"/gi)].map(m => m[1]);
      const texte = links.find(h => /\/leg\/.*(pjl|ppl|ppr)/i.test(h)) || links[0];
      if (texte) return [texte.startsWith("http") ? texte : `https://www.senat.fr${texte.startsWith("/") ? "" : "/"}${texte}`];
    }
  }
  return [];
}

// Isole l'exposé des motifs dans le texte brut du PDF (sinon renvoie le début du texte, borné).
function extractExpose(raw: string): string {
  const t = raw.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  const flat = t.replace(/\s+/g, " ");
  const i = flat.search(/expos[ée]\s+des\s+motifs/i);
  const body = i >= 0 ? flat.slice(i) : flat;
  // Coupe avant le dispositif article par article (« Article 1er », « Article unique ») pour garder l'argumentaire.
  const cut = body.search(/\bArticle\s+(1\s*er|unique|premier)\b/i);
  const kept = cut > 400 ? body.slice(0, cut) : body;
  return kept.slice(0, MAX_CHARS).trim();
}

export async function fetchExposeText(sourceUrls: string[] | null | undefined): Promise<string | null> {
  for (const src of (sourceUrls ?? []).slice(0, 3)) {
    if (!src) continue;
    const pdfUrls = await pdfUrlsFromSource(src);
    for (const u of pdfUrls) {
      const raw = await pdfText(u);
      if (raw && raw.length > 200) {
        const ex = extractExpose(raw);
        if (ex.length > 200) return ex;
      }
    }
  }
  return null;
}
