import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { sansAccent } from "../../lib/cycles.js";

/**
 * CYCLE AUDITIONS — agent « vidéothécaire » (sans IA).
 *
 * Sa seule tâche : rattacher à chaque audition de l'Assemblée la vidéo officielle de la
 * réunion, pour que le site propose « Vidéo » à côté du compte rendu. L'open data ne donne
 * pas ce lien : il faut le retrouver sur le portail vidéo de l'Assemblée, qui liste les
 * réunions de commission par ordre chronologique, l'adresse de chaque vidéo portant son
 * intitulé et sa date.
 *
 * Le rapprochement est le même que pour la transcription : même jour, et le NOM DE FAMILLE
 * d'une personne entendue (ou un sigle entre parenthèses) présent dans l'adresse de la vidéo,
 * avec une seule vidéo candidate. Sans cela, on ne met rien : un bouton « Vidéo » qui ouvre
 * une autre audition serait pire que pas de bouton.
 *
 * Le Sénat suit la même règle, sur son propre portail (videos.senat.fr).
 *
 * Usage : npx tsx src/scripts/agents/auditions-videos.ts [--jours=150] [--chambre=senat] [--dry-run]
 */
const JOURS = Number(process.argv.find(a => a.startsWith("--jours="))?.split("=")[1] || 150);
const DRY = process.argv.includes("--dry-run");
const SEULE = process.argv.find(a => a.startsWith("--chambre="))?.split("=")[1];
const PORTAIL = "https://videos.assemblee-nationale.fr";
const NAVIGATEUR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
const BANALS = new Set(["commission", "audition", "representants", "nationale", "national", "presse", "ouverte", "president", "presidente",
  "directeur", "directrice", "general", "generale", "mission", "information", "enquete", "ministre", "france"]);

type Video = { url: string; date: string; mots: Set<string> };

async function indexVideos(jusqua: string): Promise<Video[]> {
  const videos = new Map<string, Video>();
  for (let page = 1; page <= 120; page++) {
    let html: string;
    try {
      const r = await fetch(`${PORTAIL}/commissions.p${page}`, { headers: { "User-Agent": NAVIGATEUR }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) break;
      html = await r.text();
    } catch { break; }
    let plusAncienne = "9999";
    for (const m of html.matchAll(/href="(video\.[\w.]+?\.([a-z0-9-]+?)-(\d{1,2})(?:er)?-([a-z]+)-(\d{4}))"/g)) {
      const mois = MOIS.indexOf(m[4]);
      if (mois < 0) continue;
      const date = `${m[5]}-${String(mois + 1).padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      if (date < plusAncienne) plusAncienne = date;
      videos.set(m[1], { url: `${PORTAIL}/${m[1]}`, date, mots: new Set(m[2].split("-").filter(x => x.length >= 3)) });
    }
    if (plusAncienne < jusqua) break;
    await new Promise(x => setTimeout(x, 350));
  }
  return [...videos.values()];
}

/** Noms de famille des personnes entendues et sigles entre parenthèses. */
function reperes(intitule: string): Set<string> {
  const out = new Set<string>();
  for (const m of intitule.matchAll(/(?:\bMM?\.|\bMmes?|\bDr|\bMe)\s+((?:[A-ZÀ-Ý][\wÀ-ÿ'’-]*\s+){0,3}[A-ZÀ-Ý][\wÀ-ÿ'’-]*)/g)) {
    const dernier = m[1].trim().split(/\s+/).pop() ?? "";
    // Trois lettres suffisent (« M. Étienne Pot ») : le nom est cherché comme mot entier de
    // l'adresse de la vidéo, pas comme morceau d'un autre mot.
    for (const part of sansAccent(dernier).split(/[^a-z]+/)) if (part.length >= 3 && !BANALS.has(part)) out.add(part);
  }
  for (const m of intitule.matchAll(/\(([A-Z]{3,8})\)/g)) out.add(m[1].toLowerCase());
  return out;
}

/* ───────────────────────────── Sénat ───────────────────────────── */

const PORTAIL_SENAT = "https://videos.senat.fr";

/**
 * Les vidéos du Sénat : une page par commission (« commission.FINC »), chaque carte donnant
 * l'adresse de la vidéo et sa date en toutes lettres. Le portail coupe la connexion quand on
 * l'interroge trop vite : une demande toutes les secondes et demie, pas plus.
 */
async function indexSenat(jusqua: string): Promise<Video[]> {
  const lire = async (chemin: string): Promise<string | null> => {
    for (let essai = 0; essai < 3; essai++) {
      try {
        const r = await fetch(`${PORTAIL_SENAT}/${chemin}`, { headers: { "User-Agent": NAVIGATEUR }, signal: AbortSignal.timeout(30000) });
        if (r.ok) return await r.text();
        if (r.status === 404) return null;
      } catch { /* on réessaie après une pause */ }
      await new Promise(x => setTimeout(x, 8000));
    }
    return null;
  };
  const accueil = await lire("");
  if (!accueil) return [];
  const codes = [...new Set([...accueil.matchAll(/href="commission\.([A-Za-z]+)"/g)].map(m => m[1]))];
  const videos = new Map<string, Video>();
  for (const code of codes) {
    for (let page = 1; page <= 3; page++) {
      await new Promise(x => setTimeout(x, 1500));
      const html = await lire(page === 1 ? `commission.${code}` : `commission.${code}.p${page}`);
      if (!html) break;
      let plusAncienne = "9999", trouvees = 0;
      for (const m of html.matchAll(/href="(video\.[\w.]+?\.([a-z0-9-]+))"[\s\S]{0,500}?card-time">\s*[A-Za-zéû]+\s+(\d{1,2})(?:er)?\s+([a-zéû]+)\s+(\d{4})/g)) {
        const mois = MOIS.indexOf(sansAccent(m[4]));
        if (mois < 0) continue;
        const date = `${m[5]}-${String(mois + 1).padStart(2, "0")}-${m[3].padStart(2, "0")}`;
        if (date < plusAncienne) plusAncienne = date;
        trouvees++;
        videos.set(m[1], { url: `${PORTAIL_SENAT}/${m[1]}`, date, mots: new Set(m[2].split("-").filter(x => x.length >= 3)) });
      }
      if (!trouvees || plusAncienne < jusqua) break;
    }
  }
  return [...videos.values()];
}

async function senat(depuis: string) {
  const { data: reunions, error } = await supabase.from("commission_reports")
    .select("ref, title, meeting_date").eq("chamber", "SENAT").is("video_url", null).gte("meeting_date", depuis)
    .or("title.ilike.%audition%,title.ilike.%table ronde%").order("meeting_date", { ascending: false }).limit(1000);
  if (error) throw error;
  if (!reunions?.length) { console.log("  Sénat : aucune audition sans vidéo."); return; }
  const videos = await indexSenat(reunions[reunions.length - 1].meeting_date);
  console.log(`  Sénat : ${reunions.length} audition(s) sans vidéo, ${videos.length} vidéo(s) relevée(s) sur le portail`);
  let rattachees = 0;
  for (const r of reunions) {
    const noms = reperes(r.title || "");
    if (!noms.size) continue;
    const candidates = videos.filter(v => v.date === r.meeting_date && [...noms].some(n => v.mots.has(n)));
    if (candidates.length !== 1) continue;
    rattachees++;
    if (!DRY) await supabase.from("commission_reports").update({ video_url: candidates[0].url }).eq("ref", r.ref);
  }
  console.log(`  Sénat : ${rattachees} vidéo(s) rattachée(s) sans équivoque sur ${reunions.length}`);
}

async function main() {
  console.log(`=== Auditions · vidéothécaire${DRY ? " (essai, rien n'est écrit)" : ""} ===`);
  const depuis = new Date(Date.now() - JOURS * 864e5).toISOString().slice(0, 10);
  const { data: reunions, error } = await supabase.from("commission_reports")
    .select("ref, title, meeting_date").eq("chamber", "AN").is("video_url", null).gte("meeting_date", depuis)
    .or("title.ilike.%audition%,title.ilike.%table ronde%").order("meeting_date", { ascending: false }).limit(1000);
  if (error) throw error;
  if (!SEULE || SEULE === "senat") await senat(depuis).catch(e => console.warn(`  ! Sénat : ${e.message}`));
  if (SEULE === "senat") return;
  if (!reunions?.length) { console.log("  Aucune audition sans vidéo."); return; }

  const videos = await indexVideos(reunions[reunions.length - 1].meeting_date);
  console.log(`  ${reunions.length} audition(s) sans vidéo, ${videos.length} vidéo(s) relevée(s) sur le portail`);

  let rattachees = 0;
  for (const r of reunions) {
    // Seulement les réunions dont l'objet EST une audition. Une réunion à plusieurs points
    // (« désignation de rapporteurs ; audition de… ; examen de… ») correspond à plusieurs
    // vidéos : lui en attacher une seule donnerait un bouton qui n'ouvre qu'un morceau.
    if (!/audition|table ronde/i.test((r.title || "").slice(0, 60))) continue;
    const noms = reperes(r.title || "");
    if (!noms.size) continue;
    const candidates = videos.filter(v => v.date === r.meeting_date && [...noms].some(n => v.mots.has(n)));
    if (candidates.length !== 1) continue;
    rattachees++;
    if (!DRY) await supabase.from("commission_reports").update({ video_url: candidates[0].url }).eq("ref", r.ref);
  }
  console.log(`  ${rattachees} vidéo(s) rattachée(s) sans équivoque sur ${reunions.length}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
