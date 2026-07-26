import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { UA, sleep, norm, wikipedia, wikipediaByTitle, structureBio, wikidata } from "../lib/bio-pipeline.js";

// Photos + bios des maires — périmètre : communes ≥ MIN_POP habitants (défaut 5000) pour
// maîtriser le coût IA. Fiche RNE conservée pour toutes les autres (aucune invention).
// Wikidata-first (titre exact FR + garde-fou date de naissance), repli faits Wikidata.
const BIO_VERSION = "mayor-1";
const MIN_POP = Number(process.env.MAYOR_MIN_POP || process.argv.find(a => a.startsWith("--min-pop="))?.split("=")[1] || 5000);

async function main() {
  const force = process.argv.includes("--force");
  console.log(`--- PHOTOS + BIOS MAIRES (communes ≥ ${MIN_POP} hab.) ---`);
  const { data: rows, error } = await supabase.from("mayors")
    .select("insee_code, commune_name, full_name, first_name, last_name, birth_date, bio, population")
    .gte("population", MIN_POP)
    .order("population", { ascending: false });
  if (error) throw error;
  const todo = (rows ?? []).filter(m => force || !m.bio || (m.bio as any)?._v !== BIO_VERSION);
  console.log(`> ${todo.length}/${rows?.length ?? 0} à traiter.`);

  const guardRegex = /maire|adjoint|conseiller municipal|d[ée]put[ée]|s[ée]nateur|conseiller/i;
  let rich = 0, facts = 0, skip = 0;
  for (const m of todo) {
    const name = m.full_name || `${m.first_name} ${m.last_name}`;
    const commune = m.commune_name || "";
    try {
      const wd = await wikidata(name, m.birth_date || null, {
        guardRegex, bioVersion: BIO_VERSION,
        summary: (n, party) => `${n}${party ? `, ${party}` : ""}, est maire${commune ? ` de ${commune}` : ""}.`,
      });

      let art = wd?.frwiki ? await wikipediaByTitle(wd.frwiki) : null;
      if (!art) { const w = await wikipedia(name); if (w && w.extract.length >= 250) {
        const ok = (commune && norm(w.extract).includes(norm(commune))) || /\bmaire\b/i.test(w.extract);
        if (ok) art = w;
      } }
      if (art && art.extract.length >= 250) {
        const bio = await structureBio(name, "maire", commune, art.extract);
        if (bio) {
          const update: any = { bio: { ...bio, _v: BIO_VERSION }, biography: bio.summary || null };
          update.photo_url = art.photo || wd?.photo || undefined;
          if (wd?.party) update.party = wd.party;
          await supabase.from("mayors").update(update).eq("insee_code", m.insee_code);
          rich++; console.log(`  ✓ ${name} — ${commune} [Wikipédia]${update.photo_url ? " +photo" : ""}`);
          await sleep(400); continue;
        }
      }
      if (wd) {
        const update: any = { bio: wd.bio, biography: wd.bio.summary || null };
        if (wd.photo) update.photo_url = wd.photo;
        if (wd.party) update.party = wd.party;
        await supabase.from("mayors").update(update).eq("insee_code", m.insee_code);
        facts++; console.log(`  ✓ ${name} — ${commune} [Wikidata]${wd.photo ? " +photo" : ""}`);
      } else { skip++; }
    } catch (e: any) { console.warn(`  ! ${name}: ${e.message}`); }
    await sleep(300);
  }
  console.log(`--- TERMINE. ${rich} riches, ${facts} factuels, ${skip} sans source. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
