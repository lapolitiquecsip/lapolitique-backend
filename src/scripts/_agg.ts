import fs from "fs";
// Agrège le score du bloc RN (nuances RN + UXD) par département, 1er tour législatives 2024.
// Source officielle : data.gouv.fr / Ministère de l'Intérieur.
const URL = "https://www.data.gouv.fr/api/1/datasets/r/e84ccc57-3349-408a-b1f3-66f235ad240b";
const RN_NUANCES = new Set(["RN", "UXD"]); // RN et Union de l'extrême droite (alliés)

async function run() {
  const j: any = await (await fetch(URL, { signal: AbortSignal.timeout(40000) })).json();
  const out: Record<string, number> = {};
  let natRn = 0, natExp = 0;
  const nuanceSet = new Set<string>();
  for (const dept of Object.keys(j)) {
    const circos = j[dept]?.circonscriptions || {};
    let rn = 0, exp = 0;
    for (const c of Object.values<any>(circos)) {
      exp += Number(c?.votes?.expressed || 0);
      for (const cand of (c?.candidates || [])) {
        nuanceSet.add(cand.nuance);
        if (RN_NUANCES.has(cand.nuance)) rn += Number(cand.vote || 0);
      }
    }
    if (exp > 0) { out[dept] = Math.round((rn / exp) * 1000) / 10; natRn += rn; natExp += exp; }
  }
  console.log("nuances présentes:", [...nuanceSet].sort().join(", "));
  console.log("national RN+UXD:", ((natRn / natExp) * 100).toFixed(2), "% | départements:", Object.keys(out).length);
  // top 8 et bottom 5
  const sorted = Object.entries(out).sort((a, b) => b[1] - a[1]);
  console.log("TOP:", sorted.slice(0, 8).map(([d, v]) => `${d}:${v}`).join(" "));
  console.log("BAS:", sorted.slice(-5).map(([d, v]) => `${d}:${v}`).join(" "));
  fs.writeFileSync("rn2024.json", JSON.stringify(out));
  console.log("écrit rn2024.json");
}
run();
