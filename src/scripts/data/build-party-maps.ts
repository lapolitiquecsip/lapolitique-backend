import fs from "fs";
import path from "path";
// Construit, pour CHAQUE parti, le score par DÉPARTEMENT à 3 élections, depuis les données
// OFFICIELLES du ministère de l'Intérieur (data.gouv.fr). Écrit un fichier de données côté front.

const EURO_CSV = "https://static.data.gouv.fr/resources/resultats-des-elections-europeennes-du-9-juin-2024/20240613-154909/resultats-definitifs-par-departement.csv";
const PRES_TXT = "https://static.data.gouv.fr/resources/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-1er-tour/20220414-152356/resultats-par-niveau-dpt-t1-france-entiere.txt";
const LEG_JSON = "https://www.data.gouv.fr/api/1/datasets/r/9613fea4-adbe-44df-825d-5ed3c4a4c6ac";

const deacc = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const normDept = (c: string) => (/^0\d[AB0-9]$/.test(c) ? c.slice(1) : c);
const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 1000) / 10 : 0;

// Parti → clé de liste européenne (tête de liste), candidat présidentiel 2022, nuances législatives.
// euro = code de nuance de la liste européenne 2024 (LRN, LENS…) ; pres = nom du candidat 2022 ;
// leg = nuances législatives 2024 (coalition).
const PARTIES: Array<{ slug: string; euro?: string; pres?: string; leg?: string[] }> = [
  { slug: "rassemblement-national", euro: "LRN", pres: "LE PEN", leg: ["RN", "UXD"] },
  { slug: "renaissance", euro: "LENS", pres: "MACRON", leg: ["ENS", "HOR"] },
  { slug: "les-democrates", euro: "LENS", pres: "MACRON", leg: ["ENS", "HOR"] },
  { slug: "horizons", euro: "LENS", pres: "MACRON", leg: ["ENS", "HOR"] },
  { slug: "parti-socialiste", euro: "LUG", pres: "HIDALGO", leg: ["UG", "SOC"] },
  { slug: "la-france-insoumise", euro: "LFI", pres: "MELENCHON", leg: ["UG", "FI"] },
  { slug: "les-ecologistes", euro: "LVEC", pres: "JADOT", leg: ["UG", "ECO"] },
  { slug: "parti-communiste-francais", euro: "LCOM", pres: "ROUSSEL", leg: ["UG", "COM"] },
  { slug: "les-republicains", euro: "LLR", pres: "PECRESSE", leg: ["LR"] },
  { slug: "union-des-droites", pres: undefined, leg: ["UXD"] },
];

type Series = Record<string, number>;
const result: Record<string, { euro?: { national: number; dept: Series }; pres?: { national: number; dept: Series }; leg?: { national: number; dept: Series } }> = {};
for (const p of PARTIES) result[p.slug] = {};

// ---------- EUROPÉENNES 2024 (CSV wide, une ligne/dept, blocs de 8 colonnes par liste) ----------
async function euro() {
  const buf = Buffer.from(await (await fetch(EURO_CSV, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
  const lines = buf.toString("utf8").split(/\r?\n/).filter(Boolean);
  const parse = (l: string) => l.split(";").map(s => s.replace(/^"|"$/g, ""));
  const H = parse(lines[0]);
  const iDept = 0, iExp = H.findIndex(h => h === "Exprimés");
  // Blocs de liste : repère chaque "Nuance liste N" et son "Voix N".
  const blocks: { nuance: number; voix: number }[] = [];
  for (let i = 0; i < H.length; i++) { const m = H[i].match(/^Nuance liste (\d+)$/); if (m) blocks.push({ nuance: i, voix: H.findIndex(h => h === `Voix ${m[1]}`) }); }
  const natVoix: Record<string, number> = {}; let natExp = 0;
  const dept: Record<string, Series> = {};
  for (let r = 1; r < lines.length; r++) {
    const c = parse(lines[r]); if (c.length < iExp) continue;
    const code = c[iDept]; if (!code || code === "FE") continue;
    const exp = Number((c[iExp] || "").replace(/\D/g, "")); if (!exp) continue;
    natExp += exp;
    for (const p of PARTIES) {
      if (!p.euro) continue;
      const blk = blocks.find(b => (c[b.nuance] || "").trim() === p.euro);
      if (!blk) continue;
      const v = Number((c[blk.voix] || "").replace(/\D/g, ""));
      (dept[p.slug] ||= {})[normDept(code)] = pct(v, exp);
      natVoix[p.slug] = (natVoix[p.slug] || 0) + v;
    }
  }
  for (const p of PARTIES) if (p.euro && dept[p.slug]) result[p.slug].euro = { national: pct(natVoix[p.slug], natExp), dept: dept[p.slug] };
}

// ---------- PRÉSIDENTIELLE 2022 1er tour (TXT ; blocs de 7 colonnes par candidat) ----------
async function pres() {
  const buf = Buffer.from(await (await fetch(PRES_TXT, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
  const lines = buf.toString("latin1").split(/\r?\n/).filter(Boolean);
  const H = lines[0].split(";");
  const iExp = H.findIndex(h => h === "Exprimés");
  const natVoix: Record<string, number> = {}; let natExp = 0;
  const dept: Record<string, Series> = {};
  for (let r = 1; r < lines.length; r++) {
    const c = lines[r].split(";");
    const code = c[0]?.trim(); const exp = Number((c[iExp] || "").replace(/\D/g, ""));
    if (!code || !exp) continue;
    natExp += exp;
    // Candidats : repère chaque colonne « Sexe » (M/F) → Nom = +1, Voix = +3 (robuste).
    for (let k = iExp; k + 3 < c.length; k++) {
      if (c[k] !== "M" && c[k] !== "F") continue;
      const nom = deacc(c[k + 1] || ""); const voix = Number((c[k + 3] || "").replace(/\D/g, ""));
      if (!voix) continue;
      for (const p of PARTIES) if (p.pres && nom.includes(deacc(p.pres))) {
        (dept[p.slug] ||= {})[normDept(code)] = pct(voix, exp);
        natVoix[p.slug] = (natVoix[p.slug] || 0) + voix;
      }
    }
  }
  for (const p of PARTIES) if (p.pres && dept[p.slug]) result[p.slug].pres = { national: pct(natVoix[p.slug], natExp), dept: dept[p.slug] };
}

// ---------- LÉGISLATIVES 2024 1er tour (JSON par dept ; nuances par candidat) ----------
async function leg() {
  const j: any = await (await fetch(LEG_JSON, { signal: AbortSignal.timeout(60000) })).json();
  const natVoix: Record<string, number> = {}; let natExp = 0;
  const dept: Record<string, Series> = {};
  for (const code of Object.keys(j)) {
    let exp = 0; const byNuance: Record<string, number> = {};
    for (const circ of Object.values<any>(j[code]?.circonscriptions || {})) {
      exp += Number(circ?.votes?.expressed || 0);
      for (const cand of (circ?.candidates || [])) byNuance[cand.nuance] = (byNuance[cand.nuance] || 0) + Number(cand.vote || 0);
    }
    if (!exp) continue; natExp += exp;
    for (const p of PARTIES) {
      if (!p.leg) continue;
      const v = p.leg.reduce((s, n) => s + (byNuance[n] || 0), 0);
      (dept[p.slug] ||= {})[normDept(code)] = pct(v, exp);
      natVoix[p.slug] = (natVoix[p.slug] || 0) + v;
    }
  }
  for (const p of PARTIES) if (p.leg && dept[p.slug]) result[p.slug].leg = { national: pct(natVoix[p.slug], natExp), dept: dept[p.slug] };
}

async function main() {
  await euro(); console.log("européennes ok");
  await pres(); console.log("présidentielle ok");
  await leg(); console.log("législatives ok");
  // Validation nationale
  for (const p of PARTIES) {
    const r = result[p.slug];
    console.log(`${p.slug.padEnd(28)} euro:${r.euro?.national ?? "-"}  pres:${r.pres?.national ?? "-"}  leg:${r.leg?.national ?? "-"}`);
  }
  const outPath = "C:/Users/hippo/Desktop/politique-pour-tous/src/lib/data/partyElectionMaps.json";
  fs.writeFileSync(outPath, JSON.stringify(result));
  console.log("écrit", outPath);
}
main().catch(e => { console.error(e); process.exit(1); });
