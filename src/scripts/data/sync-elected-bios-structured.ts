import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { annuaireSenat, lireFicheSenat } from "../../lib/senat-fiche.js";
import { chargerAMO10, ficheOfficielle, type AN } from "../../lib/fiche-an.js";

// Bio STRUCTURÉE des DÉPUTÉS et SÉNATEURS (mêmes rubriques que les candidats/eurodéputés).
// Ancrage Wikipédia strict, garde-fou anti-homonyme (fonction ou parti). Idempotent et
// reprenable : ne traite que ceux sans bio à la bonne version.
//   Usage : npm run data:sync-deputy-bios    |    npm run data:sync-senator-bios
const which = process.argv.find(a => a === "deputies" || a === "senators") || "deputies";
const CFG = which === "senators"
  ? { table: "senators", roleLabel: "sénateur (Sénat français)", guard: /s[ée]nat/i, version: "sen-1" }
  : { table: "deputies", roleLabel: "député à l'Assemblée nationale", guard: /d[ée]put|assembl[ée]e nationale/i, version: "dep-1" };
// --payant : DeepSeek directement (solde budgété), sans attendre le quota gratuit du jour.
const PAYANT = process.argv.includes("--payant");
const LIMIT = Number((process.argv.find(a => a.startsWith("--limit="))?.split("=")[1]) || 0);
// --depuis=AAAA-MM-JJ : refait la bio des élus entrés en fonction depuis cette date (députés).
const DEPUIS = process.argv.find(a => a.startsWith("--depuis="))?.split("=")[1] || "";
// --ids=PA1,PA2 : refait la bio de ces députés précis.
const IDS = new Set((process.argv.find(a => a.startsWith("--ids="))?.split("=")[1] || "").split(",").map(s => s.trim()).filter(Boolean));

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Fetch résilient : réessaie sur throttling (429) et erreurs serveur (5xx) avec backoff.
// Sans ça, une salve de requêtes fait renvoyer "" par Wikipédia → faux « pas d'article fiable ».
async function wikiFetch(url: string, tries = 4): Promise<Response | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (r.ok) return r;
      if (r.status === 429 || r.status >= 500) { await sleep(1200 * (i + 1)); continue; } // throttling → on patiente
      return null; // 404 etc. : inutile de réessayer
    } catch { await sleep(800 * (i + 1)); } // timeout/réseau → réessai
  }
  return null;
}

// Texte intégral d'un article à partir de son titre exact.
async function extractByTitle(title: string): Promise<string> {
  const full = await wikiFetch(`https://fr.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`);
  if (!full) return "";
  try { const j: any = await full.json(); const p: any = Object.values(j?.query?.pages ?? {})[0]; return p?.extract || ""; } catch { return ""; }
}

// Recherche plein-texte → titre de la meilleure page (gère homonymies et variantes d'accents).
async function wikiSearchTitle(query: string): Promise<string | null> {
  const r = await wikiFetch(`https://fr.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(query)}`);
  if (!r) return null;
  try { const j: any = await r.json(); return j?.query?.search?.[0]?.title || null; } catch { return null; }
}

async function wikipedia(name: string): Promise<string> {
  let best = "";
  // 1) Page directe (cas nominal).
  const s = await wikiFetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, "_"))}`);
  if (s) {
    const d: any = await s.json();
    if (d.type !== "disambiguation") {
      if ((d.extract || "").length > best.length) best = d.extract || "";
      const more = await extractByTitle(d.title || name);
      if (more.length > best.length) best = more;
      // Article intégral obtenu (pas seulement le court résumé) → on s'arrête.
      if (best.length >= 1200) return best;
    }
  }
  // 2) Repli déterministe par suffixe d'homonymie (motif courant sur Wikipédia FR), quand la page
  //    directe est une page d'homonymie (ex. « Alain Marc » → « Alain Marc (homme politique) »).
  if (best.length < 250) {
    for (const suf of ["(homme politique)", "(femme politique)", "(personnalité politique)", "(sénateur)", "(député)"]) {
      const ex = await extractByTitle(`${name} ${suf}`);
      if (ex.length > best.length) best = ex;
      if (best.length >= 1200) return best;
    }
  }
  // 3) Repli recherche : homonymies restantes + accents manquants en base (« Sebastien Pla » →
  //    « Sébastien Pla »). Le garde-fou de main() (« sénat/député » ou parti présent) écarte les
  //    faux positifs (ex. un homonyme sans rapport).
  const hint = which === "senators" ? "sénateur" : "député";
  const title = await wikiSearchTitle(`${name} ${hint}`);
  if (title) { const ex = await extractByTitle(title); if (ex.length > best.length) best = ex; }
  return best;
}

/**
 * Données Wikidata d'un député, retrouvées par son identifiant Assemblée (propriété P4123) :
 * aucune homonymie possible, contrairement à une recherche par nom. Donne aussi le titre
 * exact de son article Wikipédia, quand il existe.
 */
async function wikidataDepute(anId: string): Promise<{ texte: string; frwiki: string | null }> {
  const vide = { texte: "", frwiki: null };
  const num = anId.replace(/^PA/i, "");
  const r = await wikiFetch(`https://www.wikidata.org/w/api.php?action=query&list=search&format=json&srsearch=haswbstatement:P4123=${num}`);
  const q: string | undefined = r ? (await r.json() as any)?.query?.search?.[0]?.title : undefined;
  if (!q) return vide;
  const e = await wikiFetch(`https://www.wikidata.org/wiki/Special:EntityData/${q}.json`);
  const ent: any = e ? (await e.json() as any)?.entities?.[q] : null;
  if (!ent) return vide;
  const c = ent.claims || {};
  const val = (s: any) => s?.mainsnak?.datavalue?.value;
  const date = (v: any) => (typeof v?.time === "string" ? v.time.replace(/^\+/, "").slice(0, v.precision >= 11 ? 10 : v.precision === 10 ? 7 : 4) : "");
  const quand = (s: any) => {
    const deb = date(s?.qualifiers?.P580?.[0]?.datavalue?.value), fin = date(s?.qualifiers?.P582?.[0]?.datavalue?.value);
    return deb || fin ? ` (${deb || "?"} – ${fin || "…"})` : "";
  };
  // Libellés français de tous les éléments cités, en un seul lot.
  const ids = new Set<string>();
  for (const p of ["P19", "P69", "P106", "P39", "P102", "P27"]) for (const s of c[p] || []) { const id = val(s)?.id; if (id) ids.add(id); }
  for (const s of c.P39 || []) for (const qq of ["P768", "P642", "P1001"]) for (const x of s.qualifiers?.[qq] || []) { const id = x?.datavalue?.value?.id; if (id) ids.add(id); }
  const lib = new Map<string, string>();
  const tous = [...ids];
  for (let i = 0; i < tous.length; i += 45) {
    const l = await wikiFetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${tous.slice(i, i + 45).join("|")}&props=labels&languages=fr|en&format=json`);
    const j: any = l ? await l.json() : null;
    for (const [id, x] of Object.entries<any>(j?.entities || {})) lib.set(id, x?.labels?.fr?.value || x?.labels?.en?.value || id);
  }
  const nom = (s: any) => lib.get(val(s)?.id) || "";
  const lignes = ["Source : Wikidata (élément lié à l'identifiant officiel de l'Assemblée nationale)."];
  const nais = date(val((c.P569 || [])[0]));
  if (nais) lignes.push(`Naissance : ${nais}${c.P19?.length ? ` à ${nom(c.P19[0])}` : ""}`);
  if (c.P69?.length) lignes.push(`Établissements d'enseignement fréquentés : ${(c.P69 as any[]).map(s => nom(s) + quand(s)).join(" ; ")}`);
  if (c.P106?.length) lignes.push(`Professions : ${(c.P106 as any[]).map(nom).filter(Boolean).join(" ; ")}`);
  for (const s of c.P39 || []) {
    const precis = ["P768", "P642", "P1001"].flatMap(qq => (s.qualifiers?.[qq] || []).map((x: any) => lib.get(x?.datavalue?.value?.id) || "")).filter(Boolean);
    lignes.push(`Fonction occupée : ${nom(s)}${precis.length ? ` — ${precis.join(", ")}` : ""}${quand(s)}`);
  }
  if (c.P102?.length) lignes.push(`Partis politiques : ${(c.P102 as any[]).map(s => nom(s) + quand(s)).join(" ; ")}`);
  return { texte: lignes.length > 1 ? lignes.join("\n") : "", frwiki: ent.sitelinks?.frwiki?.title ?? null };
}

async function structureBio(name: string, reference: string): Promise<any | null> {
  const resp = await resilientDeepSeek.createMessage({
    model: "deepseek-chat",
    max_tokens: 24000,   // modèle à raisonnement : grande marge pour ne pas tronquer le JSON des bios les plus longues (Rossignol…)
    responseFormat: "json_object",
    system: `Tu produis une biographie TRÈS DÉTAILLÉE et rigoureusement FACTUELLE d'un ${CFG.roleLabel}, UNIQUEMENT à partir des textes de référence fournis (fiche officielle de l'assemblée, données Wikidata et/ou article Wikipédia). En cas de désaccord, la fiche officielle prévaut. N'invente RIEN ; une rubrique sans information reste vide.

NEUTRALITÉ ABSOLUE : aucun jugement de valeur, aucun qualificatif idéologique, aucun adjectif évaluatif. Faits, dates, fonctions, chiffres.

ENTRÉE EN FONCTION : « élu(e) » ne désigne qu'une élection. Un suppléant qui remplace le titulaire (motif « remplacement… » dans la fiche officielle) n'est pas élu à la date de sa prise de fonction : écris « devient député(e) en remplacement de … » ; il a été élu suppléant lors des législatives où le binôme l'a emporté.

EXIGENCES : exhaustif et précis (dates, chiffres, lieux, intitulés). Chaque rubrique est un TABLEAU de points (3 à 8 si l'info existe). Rubrique absente → tableau vide [].

Réponds en JSON strict :
{
  "summary": "accroche 1-2 phrases, factuelle et neutre",
  "naissance": { "date": "AAAA-MM-JJ ou AAAA", "ville": "", "pays": "", "pays_code": "code ISO alpha-2 minuscule" },
  "profession": "métier d'origine hors politique, 2-4 mots, sinon \"\"",
  "formation": "école/diplôme notable, sinon \"\"",
  "enfants": "ex: \"3 enfants\", sinon \"\"",
  "famille": ["..."],
  "parents": ["père...", "mère...", "fratrie..."],
  "etudes": ["diplômes, écoles, années"],
  "parcours": ["toutes les fonctions politiques avec intitulé exact et dates, ordre chronologique"],
  "jobs": ["expériences professionnelles HORS politique, avec dates, ordre chronologique"],
  "publications": ["livres/tribunes écrits par la personne, titre + année"],
  "passions": ["hobbies personnels non politiques"],
  "faits_marquants": ["événements marquants avec dates/chiffres"],
  "realisations": ["actions concrètes par fonction et date (lois, rapports, textes portés, etc.)"],
  "positions": ["principales positions programmatiques, formulées neutrement"],
  "controverses": ["affaires/mises en cause/condamnations avec dates et faits, sans jugement"],
  "chronologie": ["AAAA : événement clé"]
}`,
    messages: [{ role: "user", content: `Personne : ${name} (${CFG.roleLabel})\n\nTexte de référence :\n${reference.slice(0, 40000)}` }],
    sansReflexion: true,
  }, { timeoutMs: 150000, payant: PAYANT });
  const text = (resp.content?.[0]?.text ?? "").replace(/```json\s*|\s*```/g, "").trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function main() {
  const force = process.argv.includes("--force");
  console.log(`--- BIOS STRUCTURÉES ${CFG.table.toUpperCase()} ---`);
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(CFG.table).select(which === "senators" ? "id, first_name, last_name, party, bio, sitting, senate_matricule" : "id, an_id, first_name, last_name, party, bio, biography, sitting, date_prise_fonction").range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  // Élus en fonction seulement, et ceux qui n'ont aucune bio d'abord : les nouveaux
  // sénateurs passaient après les anciens et n'étaient jamais atteints.
  const cible = (m: any) => (DEPUIS && m.date_prise_fonction && m.date_prise_fonction >= DEPUIS) || (m.an_id && IDS.has(m.an_id));
  const todo = rows.filter(m => m.sitting !== false && (force || cible(m) || !m.bio || (m.bio as any)?._v !== CFG.version))
    .sort((a, b) => Number(!!a.bio) - Number(!!b.bio));
  // Sénateurs : la fiche officielle senat.fr (état civil, mandats, fonctions antérieures)
  // complète Wikipédia, et suffit seule pour un élu sans article.
  const annuaire = which === "senators" ? await annuaireSenat() : new Map<string, string>();
  // Députés : fiche officielle de l'Assemblée (état civil, profession, motif d'entrée, organes).
  const an: AN | null = which === "deputies" ? await chargerAMO10() : null;
  console.log(`> ${todo.length}/${rows.length} à (re)structurer${LIMIT ? ` (limite ${LIMIT})` : ""}.`);

  let ok = 0, skip = 0, quotaVide = 0;
  for (const m of todo) {
    if (LIMIT && ok >= LIMIT) break;
    const name = `${m.first_name || ""} ${m.last_name || ""}`.trim();
    try {
      // Député : Wikidata retrouvé par l'identifiant AN donne le titre exact de l'article,
      // sans risque d'homonyme ; à défaut, recherche par nom comme pour les sénateurs.
      const wd = an && m.an_id ? await wikidataDepute(m.an_id) : { texte: "", frwiki: null };
      const wiki = wd.frwiki ? await extractByTitle(wd.frwiki) : await wikipedia(name);
      const okRole = CFG.guard.test(wiki);
      const okParty = m.party && norm(wiki).includes(norm(m.party));
      const wikiFiable = wiki.length >= 250 && (!!wd.frwiki || okRole || okParty);
      const urlSenat = m.senate_matricule ? annuaire.get(String(m.senate_matricule).toLowerCase()) : undefined;
      const acteur = an && m.an_id ? an.acteurs.get(String(m.an_id).trim()) : null;
      const officiel = urlSenat ? (await lireFicheSenat(urlSenat))?.texte ?? ""
        : acteur && an ? ficheOfficielle(acteur, an) : "";
      if (!wikiFiable && officiel.length < 150) { skip++; console.log(`  · ${name} : ni article fiable ni fiche officielle.`); await sleep(300); continue; }
      const ref = [
        officiel && (urlSenat ? `FICHE OFFICIELLE DU SÉNAT (senat.fr) :\n${officiel}` : `FICHE OFFICIELLE DE L'ASSEMBLÉE NATIONALE :\n${officiel}`),
        wd.texte && `DONNÉES WIKIDATA :\n${wd.texte}`,
        wikiFiable && `ARTICLE WIKIPÉDIA :\n${wiki}`,
      ].filter(Boolean).join("\n\n");
      let bio;
      try { bio = await structureBio(name, ref); quotaVide = 0; }
      catch (e: any) {
        // Toutes les lignées gratuites refusent deux fois de suite : quota du jour épuisé.
        if (/Aucun modèle gratuit disponible/.test(String(e?.message)) && ++quotaVide >= 2) {
          console.log("::warning::Quota IA gratuit épuisé : passage interrompu, reprise au prochain.");
          break;
        }
        throw e;
      }
      if (!bio) { skip++; console.log(`  · ${name} : structuration échouée.`); await sleep(300); continue; }
      // Le texte court (repli du site quand la bio structurée manque) suit le résumé s'il est vide.
      const maj: any = { bio: { ...bio, _v: CFG.version } };
      if (which === "deputies" && !m.biography && bio.summary) maj.biography = bio.summary;
      await supabase.from(CFG.table).update(maj).eq("id", m.id);
      ok++; if (ok % 25 === 0) console.log(`  … ${ok} faites`);
    } catch (e: any) { console.warn(`  ! ${name}: ${e.message}`); }
    await sleep(400);
  }
  console.log(`--- TERMINE. ${ok} structurées, ${skip} sans article. ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
