import "dotenv/config";
import AdmZip from "adm-zip";
import { supabase } from "../../config/supabase.js";

// Roster AUTORITAIRE des députés en fonction — dataset officiel AN « députés actifs » (AMO10).
// Détecte les départs (décès, démission, nomination au gouvernement → remplacement par le
// suppléant…) : un député de notre base absent du roster actif AN → sitting=false ; présent → true.
// Source fiable (contrairement au CSV datan, incomplet). Garde-fou : on n'écrit rien si le roster
// récupéré est anormalement petit (téléchargement partiel). DRY_RUN=1 = compte seulement.

const ZIP_URL = "https://data.assemblee-nationale.fr/static/openData/repository/17/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip";

async function main() {
  const dry = process.env.DRY_RUN === "1";
  console.log("Téléchargement du roster des députés actifs (AN)…");
  const res = await fetch(ZIP_URL, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`AMO10 HTTP ${res.status}`);
  const entries = new AdmZip(Buffer.from(await res.arrayBuffer())).getEntries().filter(e => /\.json$/.test(e.entryName));

  const active = new Set<string>();
  for (const e of entries) {
    try { const a = JSON.parse(e.getData().toString("utf8")).acteur; const u = a?.uid?.["#text"] || a?.uid; if (typeof u === "string" && u.startsWith("PA")) active.add(u); } catch { /* ignore */ }
  }
  console.log(`Roster actif AN : ${active.size} députés.`);
  // Garde-fou : l'AN compte 577 sièges. En dessous de 500, le téléchargement est douteux → on abandonne.
  if (active.size < 500) throw new Error(`Roster actif anormalement petit (${active.size}) — abandon pour ne pas flaguer à tort.`);

  const { data: deputies, error } = await supabase.from("deputies").select("id, an_id, first_name, last_name");
  if (error) throw error;

  const sitting: string[] = [], gone: { id: string; name: string }[] = [];
  for (const d of deputies || []) {
    if (d.an_id && active.has(d.an_id.trim())) sitting.push(d.id);
    else gone.push({ id: d.id, name: `${d.first_name} ${d.last_name}` });
  }
  console.log(`En fonction : ${sitting.length} · sortis : ${gone.length}`);
  for (const g of gone) console.log(`  - sorti : ${g.name}`);

  if (dry) { console.log("(DRY_RUN : aucune écriture)"); return; }

  const update = async (ids: string[], value: boolean) => {
    for (let i = 0; i < ids.length; i += 200) {
      const { error: e } = await supabase.from("deputies").update({ sitting: value }).in("id", ids.slice(i, i + 200));
      if (e) throw e;
    }
  };
  await update(sitting, true);
  await update(gone.map(g => g.id), false);
  console.log(`--- TERMINÉ. ${sitting.length} en fonction, ${gone.length} marqué(s) sortis. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
