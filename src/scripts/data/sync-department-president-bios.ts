import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Photo + bio structurée des présidents de département — Wikipédia (photo + ancrage) et
// DeepSeek (rédaction neutre, mêmes rubriques que les eurodéputés/candidats).
// Garde-fou anti-homonyme : l'article doit mentionner le département OU « conseil
// départemental / président du conseil ». Sinon on ne fabrique rien.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const BIO_VERSION = "deppres-2";

async function wikipedia(name: string): Promise<{ extract: string; photo?: string } | null> {
  try {
    const r = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, "_"))}`,
      { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const d: any = await r.json();
    if (d.type === "disambiguation") return null;
    let extract = d.extract || "";
    try {
      const full = await fetch(
        `https://fr.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(d.title || name)}`,
        { headers: UA, signal: AbortSignal.timeout(15000) });
      if (full.ok) {
        const j: any = await full.json();
        const p: any = Object.values(j?.query?.pages ?? {})[0];
        if (p?.extract && p.extract.length > extract.length) extract = p.extract;
      }
    } catch { /* résumé court */ }
    return { extract, photo: d.originalimage?.source || d.thumbnail?.source };
  } catch { return null; }
}

// Charge l'article FR complet à partir de son TITRE EXACT (résolu via Wikidata),
// ce qui évite les ratés d'accents / traits d'union du lookup par nom brut.
async function wikipediaByTitle(title: string): Promise<{ extract: string; photo?: string } | null> {
  try {
    let extract = "", photo: string | undefined;
    const s = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      { headers: UA, signal: AbortSignal.timeout(15000) });
    if (s.ok) { const d: any = await s.json(); extract = d.extract || ""; photo = d.originalimage?.source || d.thumbnail?.source; }
    const full = await fetch(
      `https://fr.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`,
      { headers: UA, signal: AbortSignal.timeout(15000) });
    if (full.ok) {
      const j: any = await full.json();
      const p: any = Object.values(j?.query?.pages ?? {})[0];
      if (p?.extract && p.extract.length > extract.length) extract = p.extract;
    }
    return extract ? { extract, photo } : null;
  } catch { return null; }
}

async function structureBio(name: string, dep: string, reference: string): Promise<any | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-chat",
    max_tokens: 8000,
    responseFormat: "json_object",
    system: `Tu produis une biographie TRÈS DÉTAILLÉE et rigoureusement FACTUELLE d'un(e) président(e) de conseil départemental français, UNIQUEMENT à partir du texte Wikipédia fourni. N'invente RIEN.

NEUTRALITÉ ABSOLUE : aucun jugement de valeur, aucun qualificatif idéologique, aucun adjectif évaluatif. Faits, dates, fonctions, chiffres.

EXIGENCES : exhaustif et précis. Chaque rubrique = TABLEAU de points (3 à 8 si l'info existe). Rubrique absente → [].

Réponds en JSON strict :
{
  "summary": "1-2 phrases factuelles et neutres",
  "profession": "métier d'origine hors politique, sinon \"\"",
  "formation": "école/diplôme notable, sinon \"\"",
  "enfants": "ex: \"3 enfants\", sinon \"\"",
  "famille": ["..."], "parents": ["père...", "mère..."], "etudes": ["diplômes, écoles, années"],
  "parcours": ["fonctions politiques avec intitulé exact et dates, ordre chronologique"],
  "jobs": ["expériences professionnelles HORS politique, avec dates"],
  "publications": ["livres/tribunes écrits, titre + année"],
  "passions": ["hobbies personnels non politiques"],
  "faits_marquants": ["événements marquants avec dates/chiffres"],
  "realisations": ["actions concrètes par fonction et date (au département notamment)"],
  "positions": ["principales positions, formulées neutrement"],
  "controverses": ["affaires/mises en cause/condamnations avec dates et faits, sans jugement"],
  "chronologie": ["AAAA : événement clé"]
}`,
    messages: [{ role: "user", content: `Président(e) du conseil départemental (${dep}) : ${name}\n\nTexte de référence :\n${reference.slice(0, 40000)}` }],
  }, { timeoutMs: 150000 });
  const text = resp.content?.[0]?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// --- Repli Wikidata : quand Wikipédia n'a pas d'article, on récupère des FAITS
// structurés et sourcés (parti, fonctions avec dates, profession, formation, image).
// Aucune prose inventée. Garde-fou anti-homonyme : la date de naissance RNE doit
// correspondre à celle de Wikidata ; à défaut, une fonction départementale doit figurer.
const wdTime = (claim: any): string | null => {
  const t = claim?.mainsnak?.datavalue?.value?.time as string | undefined;
  const m = t?.match(/^\+(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const wdYear = (d: string | null) => (d ? d.slice(0, 4) : "");

async function wikidata(name: string, rneBirth: string | null, depName: string | null): Promise<any | null> {
  const search: any = await (await fetch(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=fr&format=json&limit=5`,
    { headers: UA, signal: AbortSignal.timeout(15000) })).json();
  for (const cand of search.search || []) {
    const ent: any = await (await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${cand.id}.json`,
      { headers: UA, signal: AbortSignal.timeout(15000) })).json();
    const d = ent.entities?.[cand.id]; if (!d) continue;
    const c = d.claims || {};
    if (c.P31?.[0]?.mainsnak?.datavalue?.value?.id !== "Q5") continue; // doit être un humain
    const birth = c.P569 ? wdTime(c.P569[0]) : null;
    const positions = (c.P39 || []).map((cl: any) => ({
      id: cl.mainsnak?.datavalue?.value?.id as string,
      start: cl.qualifiers?.P580 ? wdTime({ mainsnak: cl.qualifiers.P580[0] }) : null,
      end: cl.qualifiers?.P582 ? wdTime({ mainsnak: cl.qualifiers.P582[0] }) : null,
    })).filter((x: any) => x.id);
    // Collecte des QID à libeller (fonctions, parti, profession, formation).
    const partyId = c.P102?.[0]?.mainsnak?.datavalue?.value?.id;
    const occIds = (c.P106 || []).map((x: any) => x.mainsnak?.datavalue?.value?.id).filter(Boolean);
    const eduIds = (c.P69 || []).map((x: any) => x.mainsnak?.datavalue?.value?.id).filter(Boolean);
    const ids = [...positions.map((p: any) => p.id), partyId, ...occIds, ...eduIds].filter(Boolean);
    const labels: Record<string, string> = {};
    for (let i = 0; i < ids.length; i += 45) {
      const j: any = await (await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.slice(i, i + 45).join("|")}&props=labels&languages=fr&format=json`,
        { headers: UA, signal: AbortSignal.timeout(15000) })).json();
      for (const [id, e] of Object.entries<any>(j.entities || {})) labels[id] = e.labels?.fr?.value || "";
    }
    const posLabels = positions.map((p: any) => ({ ...p, label: labels[p.id] || "" }));
    const hasDept = posLabels.some((p: any) => /d[ée]partement/i.test(p.label));
    // Garde-fou : soit la date de naissance colle, soit une fonction départementale existe.
    const birthOk = rneBirth && birth && birth === rneBirth;
    if (!birthOk && !hasDept) continue;

    const parcours = posLabels
      .filter((p: any) => p.label)
      .sort((a: any, b: any) => (a.start || "").localeCompare(b.start || ""))
      .map((p: any) => {
        const per = p.start || p.end ? ` (${wdYear(p.start)}${p.end ? "–" + wdYear(p.end) : p.start ? "–…" : ""})` : "";
        return `${p.label}${per}`;
      });
    const profession = occIds.map((id: string) => labels[id]).filter((l: string) => l && !/(femme|homme) politique|personnalité politique/i.test(l))[0] || "";
    const etudes = eduIds.map((id: string) => labels[id]).filter(Boolean);
    const party = partyId ? labels[partyId] : "";
    const image = c.P18?.[0]?.mainsnak?.datavalue?.value as string | undefined;
    const photo = image ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image.replace(/ /g, "_"))}?width=600` : undefined;

    const summary = `${name}${party ? `, ${party}` : ""}, préside le conseil départemental${depName ? ` (${depName})` : ""}.`;
    const bio: any = { summary, profession, parcours, etudes, _v: BIO_VERSION, _src: "wikidata" };
    if (party) bio.positions = [`Rattachement politique : ${party}`];
    const frwiki = d.sitelinks?.frwiki?.title as string | undefined;
    return { bio, photo, party, birth, frwiki };
  }
  return null;
}

async function main() {
  const force = process.argv.includes("--force");
  console.log("--- PHOTOS + BIOS PRÉSIDENTS DE DÉPARTEMENT ---");
  const { data: pres, error } = await supabase.from("department_presidents").select("dep_code, dep_name, full_name, first_name, last_name, birth_date, bio, photo_url");
  if (error) throw error;
  const todo = (pres ?? []).filter(p => force || !p.bio || (p.bio as any)?._v !== BIO_VERSION);
  console.log(`> ${todo.length}/${pres?.length ?? 0} à traiter.`);

  let rich = 0, facts = 0, skip = 0;
  for (const p of todo) {
    const name = p.full_name || `${p.first_name} ${p.last_name}`;
    try {
      // Wikidata en premier : il donne le TITRE EXACT de l'article FR (accents/tirets),
      // le garde-fou anti-homonyme (date de naissance) et une base de faits en repli.
      const wd = await wikidata(name, p.birth_date || null, p.dep_name || null);

      // 1) Article FR complet (via le titre Wikidata, ou à défaut le nom) -> bio riche IA.
      let art = wd?.frwiki ? await wikipediaByTitle(wd.frwiki) : null;
      if (!art) { const w = await wikipedia(name); if (w && w.extract.length >= 250) {
        const okDep = p.dep_name && norm(w.extract).includes(norm(p.dep_name));
        const okFn = /conseil d[ée]partemental|pr[ée]sident du conseil|d[ée]partement/i.test(w.extract);
        if (okDep || okFn) art = w;
      } }
      if (art && art.extract.length >= 250) {
        const bio = await structureBio(name, p.dep_name || "", art.extract);
        if (bio) {
          const update: any = { bio: { ...bio, _v: BIO_VERSION }, biography: bio.summary || null };
          update.photo_url = art.photo || wd?.photo || undefined;
          if (wd?.party) update.party = wd.party;
          await supabase.from("department_presidents").update(update).eq("dep_code", p.dep_code);
          rich++; console.log(`  ✓ ${name} (${p.dep_name}) [Wikipédia]${update.photo_url ? " +photo" : ""}`);
          await sleep(400); continue;
        }
      }

      // 2) Pas d'article : faits sourcés Wikidata (sans invention).
      if (wd) {
        const update: any = { bio: wd.bio, biography: wd.bio.summary || null };
        if (wd.photo) update.photo_url = wd.photo;
        if (wd.party) update.party = wd.party;
        await supabase.from("department_presidents").update(update).eq("dep_code", p.dep_code);
        facts++; console.log(`  ✓ ${name} (${p.dep_name}) [Wikidata]${wd.photo ? " +photo" : ""}`);
      } else { skip++; console.log(`  · ${name} (${p.dep_name}) : pas de source fiable.`); }
    } catch (e: any) { console.warn(`  ! ${name}: ${e.message}`); }
    await sleep(400);
  }
  console.log(`--- TERMINE. ${rich} riches (Wikipédia), ${facts} factuels (Wikidata), ${skip} sans source. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
