import "dotenv/config";
import { supabase } from "../../config/supabase.js";

// Comptes X/Twitter, Facebook et site personnel des députés, quand la fiche n'en a pas.
// Source : Wikidata, retrouvé par l'identifiant officiel de l'Assemblée (propriété P4123),
// donc sans homonyme possible. Ne remplace jamais une valeur déjà présente.
//   npx tsx src/scripts/data/completer-reseaux-deputes.ts [--depuis=AAAA-MM-JJ] [--dry]

const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const DRY = process.argv.includes("--dry");
const DEPUIS = process.argv.find(a => a.startsWith("--depuis="))?.split("=")[1] || "";

async function json(url: string): Promise<any> {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (r.ok) return await r.json();
      if (r.status !== 429 && r.status < 500) return null;
    } catch { /* réseau : on réessaie */ }
    await sleep(1500 * (i + 1));
  }
  return null;
}

async function main() {
  let q = supabase.from("deputies").select("id, an_id, first_name, last_name, twitter, facebook, website").eq("sitting", true)
    .or("twitter.is.null,facebook.is.null,website.is.null");
  if (DEPUIS) q = q.gte("date_prise_fonction", DEPUIS);
  const { data, error } = await q;
  if (error) throw error;
  console.log(`> ${data?.length ?? 0} fiche(s) avec au moins un champ vide.`);

  let maj = 0;
  for (const d of data || []) {
    const num = String(d.an_id || "").replace(/^PA/i, "");
    if (!num) continue;
    const s = await json(`https://www.wikidata.org/w/api.php?action=query&list=search&format=json&srsearch=haswbstatement:P4123=${num}`);
    const qid: string | undefined = s?.query?.search?.[0]?.title;
    if (!qid) { await sleep(200); continue; }
    const e = (await json(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`))?.entities?.[qid];
    // Valeur en cours seulement : un compte marqué « fin » (P582) ou obsolète est ignoré.
    const actuel = (p: string): string | null => {
      const c = (e?.claims?.[p] || []).filter((x: any) => x.rank !== "deprecated" && !x.qualifiers?.P582);
      const pref = c.find((x: any) => x.rank === "preferred") ?? c[0];
      const v = pref?.mainsnak?.datavalue?.value;
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    const champs: Record<string, string> = {};
    const tw = actuel("P2002"), fb = actuel("P2013"), web = actuel("P856");
    if (!d.twitter && tw) champs.twitter = `@${tw.replace(/^@/, "")}`;
    if (!d.facebook && fb) champs.facebook = fb;
    if (!d.website && web) champs.website = web.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
    if (Object.keys(champs).length) {
      console.log(`  ${d.first_name} ${d.last_name} : ${Object.entries(champs).map(([k, v]) => `${k}=${v}`).join(" ; ")}`);
      if (!DRY) {
        const { error: u } = await supabase.from("deputies").update(champs).eq("id", d.id);
        if (u) console.warn(`  ! ${u.message}`); else maj++;
      }
    }
    await sleep(250);
  }
  console.log(`--- TERMINÉ. ${maj} fiche(s) complétée(s)${DRY ? " (essai, rien écrit)" : ""}. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
