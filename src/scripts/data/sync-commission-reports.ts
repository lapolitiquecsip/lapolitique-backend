import "dotenv/config";
import fs from "fs";
import path from "path";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { downloadAndUnzip } from "../automation/utils.js";

// AUDITIONS & TRAVAUX DE COMMISSION : on récupère les comptes rendus ÉCRITS officiels (verbatim)
// via l'open data de l'Assemblée, et l'IA en produit un résumé « ce qui a été dit » pour l'utilisateur
// premium (les vidéos d'audition sont longues). 100 % sourcé (verbatim officiel), idempotent, reprenable.
//   Usage : npm run data:sync-commission-reports [-- --limit=20 --days=120]
const AGENDA_URL = "https://data.assemblee-nationale.fr/static/openData/repository/17/vp/reunions/Agenda.json.zip";
const LIMIT = Number(process.argv.find(a => a.startsWith("--limit="))?.split("=")[1] || 20);
const DAYS = Number(process.argv.find(a => a.startsWith("--days="))?.split("=")[1] || 120);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };

function findDir(root: string, name: string): string | null {
  for (const e of fs.readdirSync(root)) {
    const p = path.join(root, e);
    if (fs.statSync(p).isDirectory()) { if (e === name) return p; const r = findDir(p, name); if (r) return r; }
  }
  return null;
}

// Extrait un texte lisible d'une page CR open data (HTML) + un titre.
function htmlToText(html: string): { title: string; text: string } {
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "'").replace(/&laquo;|&raquo;/g, '"')
    .replace(/\s+/g, " ").trim();
  return { title, text: body };
}

async function summarize(commission: string, objet: string, verbatim: string): Promise<string | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-v4-flash",
    max_tokens: 1600,
    system: `On te donne le COMPTE RENDU officiel (verbatim) d'une réunion de commission de l'Assemblée nationale française (souvent une audition). Rédige un RÉSUMÉ clair et NEUTRE de CE QUI A ÉTÉ DIT, pour un citoyen qui n'a pas le temps de tout lire.

- 4 à 7 puces courtes, chacune un point/argument/annonce concret exprimé pendant la réunion (qui dit quoi, chiffres, positions, désaccords).
- Neutre et factuel : rapporte les propos, sans jugement ni prise de position.
- Commence par une phrase de contexte (qui est auditionné, sur quel sujet).
- N'invente rien : uniquement ce qui figure dans le verbatim.

Réponds en texte simple : une phrase de contexte, puis les puces (préfixées par « - »).`,
    messages: [{ role: "user", content: `Commission : ${commission}\nObjet : ${objet}\n\nVERBATIM :\n${verbatim.slice(0, 45000)}` }],
  }, { timeoutMs: 120000 });
  const t = (resp.content?.[0]?.text ?? "").trim();
  return t.length > 40 ? t : null;
}

async function main() {
  console.log("--- SYNC COMPTES RENDUS DE COMMISSION (auditions) ---");
  const dir = path.join(process.cwd(), "_crtmp");
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  await downloadAndUnzip(AGENDA_URL, dir);
  const rdir = findDir(dir, "reunion");
  if (!rdir) { console.error("dossier reunion introuvable"); return; }

  const cutoff = Date.now() - DAYS * 86400000;
  // Réunions de COMMISSION (compteRenduRef commençant par « CRC ») récentes, avec CR publié.
  const seen = new Set<string>();
  const items: { ref: string; organe: string; date: string; objet: string }[] = [];
  for (const f of fs.readdirSync(rdir)) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(rdir, f), "utf8")).reunion;
      const ref: string = r?.compteRenduRef || "";
      if (!ref || !/^CRC/i.test(ref) || seen.has(ref)) continue;
      const dateRaw = r.timeStampDebut || r.timestampDebut || "";
      const t = dateRaw ? new Date(dateRaw).getTime() : 0;
      if (!t || t < cutoff) continue;
      const objet = (r.ODJ?.resumeODJ?.item || r.ODJ?.pointsODJ?.pointODJ?.[0]?.objet || "").toString().replace(/\s+/g, " ").trim();
      seen.add(ref);
      items.push({ ref, organe: r.organeReuniRef || "", date: new Date(dateRaw).toISOString().slice(0, 10), objet });
    } catch { /* fichier ignoré */ }
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  console.log(`> ${items.length} compte(s) rendu de commission depuis ${DAYS} j.`);

  // Ne (re)traiter que ceux sans résumé encore en base.
  const { data: existing } = await supabase.from("commission_reports").select("ref, summary");
  const done = new Set((existing || []).filter((r: any) => r.summary).map((r: any) => r.ref));

  let ok = 0;
  for (const it of items) {
    if (ok >= LIMIT) break;
    if (done.has(it.ref)) continue;
    const url = `https://www.assemblee-nationale.fr/dyn/opendata/${it.ref}.html`;
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (!res.ok) { continue; }
      const { title, text } = htmlToText(await res.text());
      if (text.length < 800) continue; // CR vide/non publié
      // Nom de commission : souvent au début du titre de la page.
      const commission = (title.split("-")[0] || title).replace(/compte rendu.*/i, "").trim() || "Commission";
      const summary = await summarize(commission, it.objet || title, text).catch(() => null);
      if (!summary) continue;
      await supabase.from("commission_reports").upsert({
        ref: it.ref, organe_ref: it.organe, commission, title: it.objet || title,
        meeting_date: it.date, cr_url: url, summary, updated_at: new Date().toISOString(),
      }, { onConflict: "ref" });
      ok++;
      console.log(`  ✓ ${it.date} · ${commission.slice(0, 50)}`);
    } catch (e: any) { console.warn(`  ! ${it.ref}: ${e.message}`); }
    await sleep(250);
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  console.log(`--- TERMINE. ${ok} résumé(s) d'audition générés. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
