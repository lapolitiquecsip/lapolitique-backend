import "dotenv/config";
import crypto from "crypto";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";
import { lireCycle, signaler, sansAccent } from "../../lib/cycles.js";
import { PROGRAMS } from "../data/sync-candidate-proposals.js";

/**
 * CYCLE PROGRAMMES — agent 1 : le veilleur.
 *
 * Sa seule tâche : remarquer qu'un programme (ou un morceau de programme) vient de paraître.
 * Il n'écrit rien sur le site et n'appelle aucune IA. Il surveille deux choses :
 *
 *  1. Les pages « programme » des sites officiels (carte SITES). Chaque lien nouveau sous une
 *     page d'index est une parution : c'est ainsi que les plans thématiques de Jean-Luc
 *     Mélenchon sortent, un par un. Une page déjà reprise sur le site est notée « en ligne » ;
 *     une page inconnue passe à l'étape « detecte », où le rédacteur la prendra.
 *  2. La presse, pour TOUS les candidats, y compris ceux dont on ne connaît aucune page
 *     programme : quand plusieurs médias distincts annoncent qu'un candidat présente son
 *     programme, le veilleur le signale. Il ne sait pas encore où est le texte — ce signal
 *     demande donc un regard humain (étape « a_revoir »), il ne déclenche aucune rédaction.
 *
 * Usage : npx tsx src/scripts/agents/programmes-veilleur.ts [--dry-run] [--sans-presse]
 */
const AGENT = "programmes-veilleur";
const DRY = process.argv.includes("--dry-run");
const SANS_PRESSE = process.argv.includes("--sans-presse");
const UA = { "User-Agent": "Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)" };

/**
 * Pages d'index à surveiller, par candidat (identifiant d'URL de sa fiche).
 *
 * `filiere` dit qui rédige ce qui est détecté :
 *  - « sync-hebdo » : la tâche existante sync-candidate-proposals relit déjà tout le site
 *    chaque semaine. Le veilleur se contente de constater ; il ne faut pas rédiger deux fois.
 *  - « agents » : personne ne reprenait ces pages automatiquement ; le rédacteur du cycle s'en charge.
 */
const SITES: Record<string, { index: string[]; filiere: "sync-hebdo" | "agents" }> = {
  "jean-luc-melenchon": {
    filiere: "agents",
    index: [
      "https://melenchon2027.fr/programme/plans-thematiques/",
      "https://melenchon2027.fr/programme/plans-investissement/",
    ],
  },
};
// Les candidats déjà relevés chaque semaine : même adresse que la tâche existante, pour ne
// pas tenir deux listes.
const NOM_VERS_SLUG: Record<string, string> = {
  "david lisnard": "david-lisnard", "bruno retailleau": "bruno-retailleau", "delphine batho": "delphine-batho",
};
for (const [nom, p] of Object.entries(PROGRAMS)) {
  const slug = NOM_VERS_SLUG[nom];
  if (slug) SITES[slug] = { filiere: "sync-hebdo", index: [p.base + p.index] };
}

const propre = (u: string) => u.split("#")[0].split("?")[0].replace(/\/+$/, "") + "/";
const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

async function page(url: string): Promise<cheerio.CheerioAPI | null> {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) });
    if (!r.ok) { console.warn(`  ! HTTP ${r.status} ${url}`); return null; }
    return cheerio.load(await r.text());
  } catch (e: any) { console.warn(`  ! ${url} : ${e.message}`); return null; }
}

/** Liens situés SOUS une page d'index : ses sous-pages, et rien d'autre du site. */
function sousPages($: cheerio.CheerioAPI, index: string): { url: string; titre: string }[] {
  const base = new URL(index);
  const vus = new Map<string, string>();
  $("a[href]").each((_, a) => {
    let h: string;
    try { h = propre(new URL($(a).attr("href") || "", base).toString()); } catch { return; }
    if (!h.startsWith(propre(index)) || h === propre(index)) return;
    // Mêmes exclusions que la tâche hebdomadaire : appels à contribution, pôles de travail.
    if (/\/(page|feed|tag|category)\//.test(h) || /pole-de-travail|idees\/?$/i.test(h)) return;
    const titre = $(a).text().replace(/\s+/g, " ").replace(/\s*(Découvrir|En savoir plus)?\s*[→↓]\s*$/i, "").trim();
    if (!vus.has(h) || (titre.length > (vus.get(h) || "").length && titre.length < 140)) vus.set(h, titre);
  });
  return [...vus.entries()].map(([url, titre]) => ({ url, titre }));
}

/* ───────────────────────────── Presse ───────────────────────────── */

const ANNONCE = /(presente|devoile|detaille|publie|lance|officialise|leve le voile sur)\s+(son|sa|ses|le|la|les|un|une)\s+(\w+\s+){0,2}(programme|projet|plan|propositions|mesures|contre-budget|feuille de route)/;

async function annoncesPresse(nom: string): Promise<{ medias: string[]; titre: string; url: string } | null> {
  const famille = sansAccent(nom.split(" ").slice(-1)[0]);
  const q = `"${nom}" programme présidentielle when:7d`;
  const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`,
    { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  const xml = await r.text();
  const balise = (bloc: string, n: string) =>
    (bloc.match(new RegExp("<" + n + "[^>]*>([^]*?)</" + n + ">"))?.[1] ?? "").replace("<![CDATA[", "").replace("]]>", "").trim();
  const medias = new Set<string>();
  let titre = "", url = "";
  for (const it of xml.split("<item>").slice(1)) {
    const t = sansAccent(balise(it, "title"));
    if (!t.includes(famille) || /[?]|pourrait|devrait|va presenter|presentera|sondage/.test(t)) continue;
    if (!ANNONCE.test(t)) continue;
    medias.add(sansAccent(balise(it, "source")));
    if (!titre) { titre = balise(it, "title"); url = balise(it, "link"); }
  }
  return medias.size ? { medias: [...medias], titre, url } : null;
}

/** Semaine ISO, pour ne signaler une même annonce qu'une fois. */
function semaine(d = new Date()): string {
  const j = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  j.setUTCDate(j.getUTCDate() + 4 - (j.getUTCDay() || 7));
  const debut = new Date(Date.UTC(j.getUTCFullYear(), 0, 1));
  return `${j.getUTCFullYear()}-S${String(Math.ceil(((+j - +debut) / 864e5 + 1) / 7)).padStart(2, "0")}`;
}

/* ───────────────────────────── Passage ───────────────────────────── */

async function main() {
  console.log(`=== Programmes · veilleur${DRY ? " (essai, rien n'est écrit)" : ""} ===`);
  const { data: candidats, error } = await supabase.from("presidential_candidates")
    .select("id, slug, full_name").eq("status", "declared");
  if (error) throw error;
  const suivi = await lireCycle("programmes");
  let nouveaux = 0;

  for (const c of candidats ?? []) {
    const site = SITES[c.slug];
    if (site) {
      // Ce qui est déjà repris sur la fiche du candidat, par adresse de source.
      const { data: lignes } = await supabase.from("candidate_proposals")
        .select("source_url").eq("candidate_id", c.id).limit(5000);
      const enLigne = new Set((lignes ?? []).map((l: any) => propre(l.source_url || "")));

      for (const index of site.index) {
        const $ = await page(index);
        if (!$) continue;
        let pages = sousPages($, index);
        // Programme tenu sur une seule page : c'est elle qu'on suit.
        if (!pages.length) pages = [{ url: propre(index), titre: $("h1").first().text().trim() }];
        for (const p of pages) {
          const connu = suivi.get(p.url);
          const etape = enLigne.has(p.url) ? "en_ligne" : (connu && connu.etape !== "en_ligne" ? connu.etape : "detecte");
          if (connu?.etape === etape) continue;
          console.log(`  ${etape === "en_ligne" ? "=" : "★"} ${c.full_name} · ${p.titre.slice(0, 60) || p.url} → ${etape}`);
          if (etape === "detecte" && !connu) nouveaux++;
          if (DRY) continue;
          await signaler(AGENT, connu, {
            cycle: "programmes", cle: p.url, etape, sujet: c.slug, titre: p.titre.slice(0, 200) || null,
            source_url: p.url, date_objet: new Date().toISOString().slice(0, 10),
            donnees: { filiere: site.filiere, candidate_id: c.id, index, empreinte_url: md5(p.url) },
          });
        }
      }
    }

    if (SANS_PRESSE) continue;
    try {
      const a = await annoncesPresse(c.full_name);
      // Trois médias distincts : un seul titre peut être une formule, pas une parution.
      if (a && a.medias.length >= 3) {
        const cle = `presse:${c.slug}:${semaine()}`;
        if (!suivi.has(cle)) {
          // La fiche a-t-elle reçu des propositions ces dix derniers jours ? Alors l'annonce
          // est déjà reprise (programme présenté en vidéo, relevé hebdomadaire) : rien à revoir.
          const { data: recent } = await supabase.from("candidate_proposals").select("updated_at")
            .eq("candidate_id", c.id).order("updated_at", { ascending: false }).limit(1);
          const repris = !!recent?.[0]?.updated_at && Date.now() - new Date(recent[0].updated_at).getTime() < 10 * 864e5;
          console.log(`  ✎ ${c.full_name} · annonce relayée par ${a.medias.length} médias${repris ? " (déjà reprise sur sa fiche)" : ""} : ${a.titre.slice(0, 80)}`);
          if (!DRY) await signaler(AGENT, undefined, {
            cycle: "programmes", cle, etape: repris ? "en_ligne" : "a_revoir", sujet: c.slug, titre: a.titre.slice(0, 200), source_url: a.url,
            date_objet: new Date().toISOString().slice(0, 10),
            erreur: repris ? null : site ? "Annonce de presse : vérifier que la page officielle est bien surveillée."
              : "Annonce de presse : aucune page programme officielle n'est surveillée pour ce candidat. À ajouter dans SITES (programmes-veilleur.ts).",
            donnees: { medias: a.medias, signal: "presse" },
          });
        }
      }
    } catch (e: any) { console.warn(`  ! presse ${c.full_name} : ${e.message}`); }
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`=== ${nouveaux} parution(s) nouvelle(s) détectée(s) ===`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
