import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Pipeline de bios réutilisable (présidents de département, maires, …).
// Stratégie : Wikidata donne le titre EXACT de l'article FR + un garde-fou anti-homonyme
// (date de naissance) + des faits en repli. On charge l'article complet par son titre, puis
// DeepSeek rédige des rubriques STRICTEMENT factuelles. Aucune invention.
export const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export async function wikipedia(name: string): Promise<{ extract: string; photo?: string } | null> {
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

export async function wikipediaByTitle(title: string): Promise<{ extract: string; photo?: string } | null> {
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

// `roleNoun` ex. « maire », « président(e) de conseil départemental » ; `place` ex. commune/département.
export async function structureBio(name: string, roleNoun: string, place: string, reference: string): Promise<any | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-chat",
    max_tokens: 8000,
    responseFormat: "json_object",
    system: `Tu produis une biographie TRÈS DÉTAILLÉE et rigoureusement FACTUELLE d'un(e) ${roleNoun} en France, UNIQUEMENT à partir du texte Wikipédia fourni. N'invente RIEN.

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
  "realisations": ["actions concrètes par fonction et date"],
  "positions": ["principales positions, formulées neutrement"],
  "controverses": ["affaires/mises en cause/condamnations avec dates et faits, sans jugement"],
  "chronologie": ["AAAA : événement clé"]
}`,
    messages: [{ role: "user", content: `${roleNoun}${place ? ` (${place})` : ""} : ${name}\n\nTexte de référence :\n${reference.slice(0, 40000)}` }],
  }, { timeoutMs: 150000 });
  const text = resp.content?.[0]?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const wdTime = (claim: any): string | null => {
  const t = claim?.mainsnak?.datavalue?.value?.time as string | undefined;
  const m = t?.match(/^\+(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const wdYear = (d: string | null) => (d ? d.slice(0, 4) : "");

export interface WikidataResult { bio: any; photo?: string; party: string; birth: string | null; frwiki?: string; }

// `guardRegex` : une des fonctions Wikidata doit matcher (ex. /maire|d[ée]partement/i) si la
// date de naissance ne confirme pas déjà l'identité — garde-fou anti-homonyme.
export async function wikidata(
  name: string, rneBirth: string | null,
  opts: { guardRegex: RegExp; bioVersion: string; summary: (name: string, party: string) => string },
): Promise<WikidataResult | null> {
  const search: any = await (await fetch(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=fr&format=json&limit=5`,
    { headers: UA, signal: AbortSignal.timeout(15000) })).json();
  for (const cand of search.search || []) {
    const ent: any = await (await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${cand.id}.json`,
      { headers: UA, signal: AbortSignal.timeout(15000) })).json();
    const d = ent.entities?.[cand.id]; if (!d) continue;
    const c = d.claims || {};
    if (c.P31?.[0]?.mainsnak?.datavalue?.value?.id !== "Q5") continue; // humain
    const birth = c.P569 ? wdTime(c.P569[0]) : null;
    const positions = (c.P39 || []).map((cl: any) => ({
      id: cl.mainsnak?.datavalue?.value?.id as string,
      start: cl.qualifiers?.P580 ? wdTime({ mainsnak: cl.qualifiers.P580[0] }) : null,
      end: cl.qualifiers?.P582 ? wdTime({ mainsnak: cl.qualifiers.P582[0] }) : null,
    })).filter((x: any) => x.id);
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
    const hasRole = posLabels.some((p: any) => opts.guardRegex.test(p.label));
    const birthOk = rneBirth && birth && birth === rneBirth;
    if (!birthOk && !hasRole) continue;

    const parcours = posLabels.filter((p: any) => p.label)
      .sort((a: any, b: any) => (a.start || "").localeCompare(b.start || ""))
      .map((p: any) => `${p.label}${p.start || p.end ? ` (${wdYear(p.start)}${p.end ? "–" + wdYear(p.end) : p.start ? "–…" : ""})` : ""}`);
    const profession = occIds.map((id: string) => labels[id]).filter((l: string) => l && !/(femme|homme) politique|personnalité politique/i.test(l))[0] || "";
    const etudes = eduIds.map((id: string) => labels[id]).filter(Boolean);
    const party = partyId ? labels[partyId] : "";
    const image = c.P18?.[0]?.mainsnak?.datavalue?.value as string | undefined;
    const photo = image ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image.replace(/ /g, "_"))}?width=600` : undefined;

    const bio: any = { summary: opts.summary(name, party), profession, parcours, etudes, _v: opts.bioVersion, _src: "wikidata" };
    if (party) bio.positions = [`Rattachement politique : ${party}`];
    return { bio, photo, party, birth, frwiki: d.sitelinks?.frwiki?.title as string | undefined };
  }
  return null;
}
