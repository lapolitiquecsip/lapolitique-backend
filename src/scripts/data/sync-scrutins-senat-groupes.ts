import "dotenv/config";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";
import { fetchAll } from "../automation/generate-interest-notifications.js";

/**
 * Vote de chaque groupe sur les scrutins d'amendement du Sénat, lu sur la page officielle
 * (senat.fr/scrutin-public/2026/scr2026-38.html, « Analyse par groupes politiques »).
 *
 * Écrit dans legislative_scrutins : group_results (mêmes champs que scrutins.group_results à
 * l'Assemblée), result_label (« Le Sénat n'a pas adopté », vide jusqu'ici) et source_url exacte ;
 * dans legislative_votes : group_code, le groupe du sénateur le jour du vote, repéré par son nom
 * dans le bloc de son groupe. Refus si les totaux des groupes ne retombent pas sur ceux du scrutin.
 *   --sec   n'écrit rien     --max=N   N scrutins au plus
 */
const SEC = process.argv.includes("--sec");
const MAX = Number(process.argv.find(a => a.startsWith("--max="))?.split("=")[1] || 1000);
const sansAccent = (t: string) => (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[ \s]+/g, " ").trim();
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const scrutins = (await fetchAll("legislative_scrutins", "id, official_id, for_count, against_count, abstain_count, group_results",
    q => q.eq("chamber", "SENAT").ilike("title", "%amendement%").is("group_results", null))).slice(0, MAX);
  console.log(`[Groupes Sénat] ${scrutins.length} scrutin(s) à lire.`);
  let faits = 0, refuses = 0;
  for (const s of scrutins as any[]) {
    const m = /(\d{4}):(\d+)$/.exec(s.official_id || "");
    if (!m) { console.log(`::warning::Identifiant inattendu : ${s.official_id}`); refuses++; continue; }
    const url = `https://www.senat.fr/scrutin-public/${m[1]}/scr${m[1]}-${m[2]}.html`;
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!r?.ok) { console.log(`::warning::${url} : HTTP ${r?.status ?? "réseau"}`); refuses++; continue; }
    const $ = cheerio.load(await r.text());
    const resultat = $("p").filter((_, p) => /^Le S[ée]nat (n'a pas adopt|a adopt)/.test($(p).text().trim())).first().text().trim();
    const groupes: any[] = []; const blocs: { code: string; noms: string }[] = [];
    $('.accordion-item').each((_, e) => {
      const id = $(e).find(".accordion-header").attr("id") || "";
      if (!id.startsWith("accordion-scrutin-")) return;
      const code = id.replace("accordion-scrutin-", "");
      const label = $(e).find("h3").clone().find("span").remove().end().text().replace(/\s+/g, " ").replace(/^Groupe\s+/i, "").replace(/\s*:\s*\d*\s*$/, "").replace(/^(?:du|de la|de l['’]|des)\s+/i, "").trim();
      // Quatre pastilles dans l'ordre pour, contre, abstention, n'ont pas pris part.
      const n = $(e).find("ul.list-inline li").map((_, li) => Number($(li).find("span.fw-semibold").text() || 0)).get();
      groupes.push({ group_id: code, group_label: label, pour: n[0] || 0, contre: n[1] || 0, abstention: n[2] || 0, non_votant: n[3] || 0 });
      blocs.push({ code, noms: sansAccent($(e).find(".accordion-body").text()) });
    });
    const somme = (k: string) => groupes.reduce((t, g) => t + g[k], 0);
    if (!groupes.length || somme("pour") !== s.for_count || somme("contre") !== s.against_count || somme("abstention") !== s.abstain_count) {
      console.log(`::warning::${s.official_id} : groupes ${somme("pour")}/${somme("contre")}/${somme("abstention")} ≠ scrutin ${s.for_count}/${s.against_count}/${s.abstain_count}, écarté.`);
      refuses++; continue;
    }
    faits++;
    if (SEC) { if (faits <= 2) console.log(s.official_id, resultat, JSON.stringify(groupes.slice(0, 3))); await pause(150); continue; }

    const { data: votes } = await supabase.from("legislative_votes").select("id, voter_name").eq("scrutin_id", s.id).limit(500);
    const parGroupe = new Map<string, string[]>();
    for (const v of votes || []) {
      const nom = sansAccent(v.voter_name || "");
      const b = blocs.find(x => x.noms.includes(nom));
      if (b) parGroupe.set(b.code, [...(parGroupe.get(b.code) || []), v.id]);
    }
    for (const [code, ids] of parGroupe) {
      const { error } = await supabase.from("legislative_votes").update({ group_code: code }).in("id", ids);
      if (error) console.log(`  ! ${s.official_id} : ${error.message}`);
    }
    const { error } = await supabase.from("legislative_scrutins").update({ group_results: groupes, result_label: resultat || null, source_url: url }).eq("id", s.id);
    if (error) throw error;
    await pause(150);
  }
  console.log(`[Groupes Sénat] ${faits} lu(s), ${refuses} écarté(s).`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
