import "dotenv/config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extract } from "tar";
import { XMLParser } from "fast-xml-parser";
import { supabase } from "../../config/supabase.js";
import { selectJorfArchiveUrls } from "../../lib/legislative/jorf-archives.js";

// Source officielle gratuite du Journal Officiel — aucun LLM, aucun coût.
const DIRECTORY_URL = "https://echanges.dila.gouv.fr/OPENDATA/JORFSIMPLE/";
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, processEntities: false });

type Decree = { jorf_id: string; nor: string; title: string; nature: string; decree_type: string; date_publi: string; source_url: string };

// Catégorise sans IA à partir du titre.
function decreeType(title: string): string {
  const t = title.toLowerCase();
  if (/nomination|nommant|portant nomination|nomm[ée]/.test(t)) return "Nomination";
  if (/légion d'honneur|ordre national du mérite|promotion|décoration/.test(t)) return "Distinction";
  return "Réglementaire";
}

function parseDecree(xml: string): Decree | null {
  const text = parser.parse(xml)?.TEXTE;
  if (!text) return null;
  const nature = String(text.NATURE ?? "").toUpperCase();
  if (!nature.includes("DECRET") && !nature.includes("DÉCRET")) return null;
  const jorf_id = String(text.ID ?? "").trim();
  const title = String(text.TITREFULL ?? text.TITRE ?? "").trim();
  const date_publi = String(text.DATE_PUBLI ?? "").trim();
  if (!jorf_id || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date_publi)) return null;
  const eli = typeof text.ID_ELI === "string" ? text.ID_ELI : null;
  return {
    jorf_id, nor: String(text.NOR ?? "").trim(), title, nature: "DÉCRET",
    decree_type: decreeType(title), date_publi,
    source_url: eli || `https://www.legifrance.gouv.fr/jorf/id/${jorf_id}`,
  };
}

async function xmlFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return xmlFiles(p);
    return /^JORFTEXT.*\.xml$/.test(e.name) ? [p] : [];
  }));
  return nested.flat();
}

async function fetchBuffer(url: string, attempts = 5): Promise<Buffer> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`DILA HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { last = e; if (i < attempts) await new Promise(res => setTimeout(res, i * 2000)); }
  }
  throw last;
}

async function main() {
  console.log("--- SYNC DÉCRETS (JORF / DILA) ---");
  const idx = await fetch(DIRECTORY_URL, { signal: AbortSignal.timeout(30_000) });
  if (!idx.ok) throw new Error(`Index DILA HTTP ${idx.status}`);
  // Les 2 dernières archives quotidiennes (couvre le week-end / rattrapage).
  const all = selectJorfArchiveUrls(await idx.text(), DIRECTORY_URL, { year: new Date().getFullYear() });
  const urls = all.slice(-2);
  console.log(`> ${urls.length} archive(s) récente(s).`);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jorf-decrees-"));
  const decrees = new Map<string, Decree>();
  try {
    for (const url of urls) {
      const adir = await fs.mkdtemp(path.join(root, "a-"));
      const file = path.join(adir, "jorf.tar.gz");
      await fs.writeFile(file, await fetchBuffer(url));
      await extract({ file, cwd: adir, filter: p => /JORFTEXT.*\.xml$/.test(p) });
      for (const f of await xmlFiles(adir)) {
        const d = parseDecree(await fs.readFile(f, "utf8"));
        if (d) decrees.set(d.jorf_id, d);
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }

  const rows = [...decrees.values()];
  console.log(`> ${rows.length} décret(s) trouvé(s).`);
  if (rows.length) {
    const { error } = await supabase.from("decrees").upsert(rows, { onConflict: "jorf_id" });
    if (error) throw error;
  }
  console.log("--- TERMINE ---");
}

main().catch(e => { console.error(e); process.exit(1); });
