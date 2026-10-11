import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { sansAccent } from "../../lib/cycles.js";

/**
 * BANC D'ESSAI — agent « recoupeur » (sans IA) : le garde-fou contre la fausse nouvelle.
 *
 * Les fils des communes, des départements et des partis sont nourris par la presse, via
 * Google Actualités. On ne peut pas y relire l'article (lien de redirection, mur de
 * consentement) : le vérificateur du banc n'a donc pas prise sur eux. Mais on peut poser la
 * question que se pose une rédaction avant de reprendre une information : QUI D'AUTRE LA
 * DONNE ? Une nouvelle qu'un seul média rapporte n'est pas fausse, elle n'est pas recoupée.
 *
 * Pour chaque information entrée dans un fil, le recoupeur cherche, sur sept jours, les
 * médias DISTINCTS qui rapportent le même fait (titres partageant la moitié au moins de
 * leurs mots distinctifs), et note :
 *
 *   officiel       source institutionnelle (Journal officiel, .gouv.fr, préfecture, collectivité)
 *   recoupe        au moins un autre média rapporte le même fait
 *   source_unique  aucun autre média trouvé
 *
 * Il ne retire rien du site : il mesure, pendant l'essai, ce qu'un agent « recoupeur » placé
 * avant la publication aurait retenu.
 *
 * Usage : npx tsx src/scripts/agents/banc-recoupeur.ts [--max=40] [--dry-run]
 */
const AGENT = "banc-recoupeur";
const CYCLE = "banc:recoupement";
const MAX = Number(process.argv.find(a => a.startsWith("--max="))?.split("=")[1] || 40);
const DRY = process.argv.includes("--dry-run");
const UA = { "User-Agent": "Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)" };

const OFFICIEL = /\.gouv\.fr|legifrance|journal-officiel|senat\.fr|assemblee-nationale\.fr|elysee\.fr|prefecture|\bpr[ée]fet\b|conseil (d[ée]partemental|r[ée]gional)|\bmairie\b|\bville de\b|m[ée]tropole/i;
const BANALS = new Set(["apres", "avant", "contre", "entre", "depuis", "pendant", "cette", "leurs", "notre", "votre", "toute", "toutes", "selon",
  "ainsi", "alors", "aussi", "encore", "faire", "avoir", "etre", "commune", "communes", "departement", "region", "france", "francais", "politique"]);

const distinctifs = (titre: string) => [...new Set(sansAccent(titre).split(/[^a-z0-9]+/).filter(m => m.length >= 5 && !BANALS.has(m)))];

async function autresMedias(titre: string, sourceD_origine: string): Promise<{ medias: string[]; requete: string }> {
  const mots = distinctifs(titre);
  // Les mots les plus longs sont les plus discriminants (noms propres, termes techniques).
  const requete = [...mots].sort((a, b) => b.length - a.length).slice(0, 6).join(" ");
  if (mots.length < 3) return { medias: [], requete };
  const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(requete + " when:7d")}&hl=fr&gl=FR&ceid=FR:fr`,
    { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Google Actualités : HTTP ${r.status}`);
  const xml = await r.text();
  const balise = (bloc: string, n: string) =>
    (bloc.match(new RegExp("<" + n + "[^>]*>([^]*?)</" + n + ">"))?.[1] ?? "").replace("<![CDATA[", "").replace("]]>", "").trim();
  const origine = sansAccent(sourceD_origine || "");
  const medias = new Set<string>();
  for (const it of xml.split("<item>").slice(1)) {
    const media = sansAccent(balise(it, "source"));
    if (!media || (origine && (media.includes(origine) || origine.includes(media)))) continue;
    const communs = distinctifs(balise(it, "title").replace(/ - [^-]+$/, "")).filter(m => mots.includes(m)).length;
    if (communs / mots.length >= 0.5) medias.add(media);
  }
  return { medias: [...medias].slice(0, 8), requete };
}

async function main() {
  console.log(`=== Banc d'essai · recoupeur${DRY ? " (essai, rien n'est écrit)" : ""} ===`);
  const { data, error } = await supabase.from("entity_feed")
    .select("id, entity_type, source_name, source_kind, url, title, published_at, created_at")
    .order("created_at", { ascending: false }).limit(300);
  if (error) throw error;
  const { data: deja } = await supabase.from("cycle_items").select("cle").eq("cycle", CYCLE).limit(20000);
  const vus = new Set((deja ?? []).map((d: any) => d.cle));
  // Un échantillon équilibré entre les fils, plutôt que les quarante dernières communes.
  const parType = new Map<string, any[]>();
  for (const r of data ?? []) if (!vus.has(String(r.id))) parType.set(r.entity_type, [...(parType.get(r.entity_type) ?? []), r]);
  const lot: any[] = [];
  for (let i = 0; lot.length < MAX && [...parType.values()].some(l => l[i]); i++) for (const l of parType.values()) if (l[i] && lot.length < MAX) lot.push(l[i]);

  const bilan: Record<string, number> = { officiel: 0, recoupe: 0, source_unique: 0 };
  for (const r of lot) {
    let etape: string, donnees: Record<string, any> = {};
    if (r.source_kind !== "google_news" || OFFICIEL.test(`${r.source_name ?? ""} ${r.url ?? ""}`)) etape = "officiel";
    else {
      try {
        const { medias, requete } = await autresMedias(r.title ?? "", r.source_name ?? "");
        etape = medias.length ? "recoupe" : "source_unique";
        donnees = { autres_medias: medias, requete };
      } catch (e: any) { console.warn(`  ! ${e.message}`); continue; }
      await new Promise(x => setTimeout(x, 700));
    }
    bilan[etape]++;
    if (etape === "source_unique") console.log(`    seul ${String(r.source_name).slice(0, 28)} : ${String(r.title).slice(0, 90)}`);
    if (DRY) continue;
    await supabase.from("cycle_items").upsert({
      cycle: CYCLE, cle: String(r.id), etape, agent: AGENT, sujet: r.entity_type, titre: String(r.title ?? "").slice(0, 300),
      source_url: r.url, date_objet: String(r.published_at ?? r.created_at ?? "").slice(0, 10) || null,
      donnees: { ...donnees, source: r.source_name }, maj_le: new Date().toISOString(),
    }, { onConflict: "cycle,cle" });
  }
  console.log(`  ${lot.length} information(s) : ${bilan.officiel} de source officielle, ${bilan.recoupe} recoupée(s), ${bilan.source_unique} donnée(s) par un seul média`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
