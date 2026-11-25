import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { igGet, instagram } from "../../lib/instagram.js";
import { passage } from "../../lib/qg.js";

/**
 * Les yeux de Noémie (25/11/2026) : relève les statistiques Instagram toutes les 6 heures. Gratuit, sans IA.
 *
 * - Chaque post des 90 derniers jours : derniers chiffres dans instagram_posts, et une photo à 24 h,
 *   48 h, 7 j et 30 j dans instagram_releves (pour comparer des posts au même âge).
 * - Le compte : chiffres de la veille (heure de Paris) dans instagram_compte, abonnés en ligne par
 *   heure ; démographie le lundi. Instagram efface au bout de 90 jours, la base garde tout.
 *
 * Score d'un post = valeur pour 100 comptes touchés : (partages×3 + enregistrements×3 + reposts×2 +
 * commentaires×2 + likes + abonnements×5) / portée × 100. Un partage ou un enregistrement vaut plus
 * qu'un like : c'est ce qui fait circuler un post d'information. La portée se juge à part.
 *
 * `--tout` relit tous les posts (premier passage), sinon les 90 derniers jours.
 */
const AGENT = "tache:back:instagram-apprentissage.yml";
const TOUT = process.argv.includes("--tout");
const AGES = [24, 48, 168, 720];
const COMPTE = process.env.INSTAGRAM_USER_ID || "17841472097024685";

const METRIQUES = {
  carrousel: ["reach", "views", "likes", "comments", "saved", "shares", "reposts", "total_interactions", "profile_visits", "follows"],
  image: ["reach", "views", "likes", "comments", "saved", "shares", "reposts", "total_interactions", "profile_visits", "follows"],
  reel: ["reach", "views", "likes", "comments", "saved", "shares", "reposts", "total_interactions", "ig_reels_avg_watch_time"],
};

const formatDe = (m: any): keyof typeof METRIQUES =>
  m.media_product_type === "REELS" ? "reel" : m.media_type === "CAROUSEL_ALBUM" ? "carrousel" : "image";

/** Lit les métriques d'un post ; une métrique refusée (selon le format) est retirée et on réessaie. */
async function mesures(id: string, liste: string[]): Promise<Record<string, number>> {
  let reste = [...liste];
  for (let i = 0; i < 4 && reste.length; i++) {
    try {
      const r = await igGet(`${id}/insights`, { metric: reste.join(",") });
      return Object.fromEntries((r.data ?? []).map((x: any) => [x.name, Number(x.values?.[0]?.value ?? x.total_value?.value ?? 0)]));
    } catch (e) {
      const m = /support the (\w+) metric/.exec((e as Error).message);
      if (!m) throw e;
      reste = reste.filter(x => x !== m[1]);
    }
  }
  return {};
}

const score = (s: Record<string, number>) => s.reach > 0
  ? Math.round(((s.shares ?? 0) * 3 + (s.saved ?? 0) * 3 + (s.reposts ?? 0) * 2 + (s.comments ?? 0) * 2 + (s.likes ?? 0) + (s.follows ?? 0) * 5) / s.reach * 1000) / 10
  : null;

/** Traits du post lisibles sans fiche : utiles aussi pour les posts faits à la main. */
function traits(m: any) {
  const d = new Date(m.timestamp);
  const paris = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const legende: string = m.caption ?? "";
  return {
    jour: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"][paris.getDay()],
    heure: paris.getHours(),
    slides: m.children?.data?.length ?? (m.media_type === "CAROUSEL_ALBUM" ? null : 1),
    longueur_legende: legende.length,
    mots_diese: (legende.match(/#[\p{L}\d_]+/gu) ?? []).length,
    premiere_ligne: legende.split("\n")[0].slice(0, 140),
  };
}

async function posts() {
  const depuis = TOUT ? 0 : Date.now() - 90 * 86400_000;
  let suite: string | null = null, fini = false, n = 0, photos = 0;
  const { data: dejaFiches } = await supabase.from("instagram_posts").select("media_id, ref, fiche");
  const connus = new Map((dejaFiches ?? []).map((p: any) => [p.media_id, p]));
  do {
    const r: any = await igGet(`${COMPTE}/media`, {
      fields: "id,media_type,media_product_type,timestamp,permalink,caption,thumbnail_url,media_url,children{id}", limit: 50, ...(suite ? { after: suite } : {}),
    });
    const lot = (r.data ?? []) as any[];
    for (const m of lot) {
      const t = Date.parse(m.timestamp);
      if (t < depuis) { fini = true; break; }
      const format = formatDe(m);
      const s = await mesures(m.id, METRIQUES[format]);
      const avant: any = connus.get(m.id);
      const ligne = {
        media_id: m.id, format, publie_le: m.timestamp, permalink: m.permalink, legende: m.caption ?? null,
        miniature: m.thumbnail_url ?? m.media_url ?? null,
        fiche: { ...traits(m), ...(avant?.fiche ?? {}) },
        portee: s.reach ?? null, vues: s.views ?? null, likes: s.likes ?? null, commentaires: s.comments ?? null,
        enregistrements: s.saved ?? null, partages: s.shares ?? null, reposts: s.reposts ?? null, interactions: s.total_interactions ?? null,
        visites_profil: s.profile_visits ?? null, abonnements: s.follows ?? null, visionnage_moyen_ms: s.ig_reels_avg_watch_time ?? null,
        score: score(s), maj_le: new Date().toISOString(),
      };
      const { error } = await supabase.from("instagram_posts").upsert(ligne);
      if (error) throw new Error(`instagram_posts : ${error.message}`);
      // Photo au premier relevé qui suit chaque âge clé (un relevé toutes les 6 h : à 6 h près).
      const age = (Date.now() - t) / 3600e3;
      for (const a of AGES.filter(a => age >= a && age < a * 1.5 + 12)) {
        const { error: e2, count } = await supabase.from("instagram_releves")
          .upsert({ media_id: m.id, age_heures: a, mesures: { ...s, age_reel: Math.round(age) } }, { onConflict: "media_id,age_heures", ignoreDuplicates: true, count: "exact" });
        if (e2) throw new Error(`instagram_releves : ${e2.message}`);
        photos += count ?? 0;
      }
      n++;
    }
    suite = !fini && r.paging?.next ? r.paging.cursors?.after ?? null : null;
  } while (suite);
  return { n, photos };
}

/** Abonnés en ligne : Instagram donne les heures en heure du Pacifique ; on les range en heure de Paris. */
function heuresParis(valeur: Record<string, number>, finUtc: string) {
  // end_time = minuit heure du Pacifique en UTC ; décalage Pacifique→UTC = heure UTC de end_time.
  const decalagePacifique = new Date(finUtc).getUTCHours();
  const offsetParis = (() => {
    const d = new Date(finUtc);
    const p = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
    const u = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
    return Math.round((p.getTime() - u.getTime()) / 3600e3);
  })();
  const sortie: Record<string, number> = {};
  for (const [h, v] of Object.entries(valeur)) sortie[String((Number(h) + decalagePacifique + offsetParis + 48) % 24)] = v;
  return sortie;
}

async function compte() {
  const ig = await instagram();
  const noeud = await igGet(COMPTE, { fields: "followers_count,media_count" });
  // La veille, heure de Paris.
  const maintenant = new Date();
  const paris = new Date(maintenant.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const hier = new Date(Date.UTC(paris.getFullYear(), paris.getMonth(), paris.getDate() - 1));
  const jour = hier.toISOString().slice(0, 10);
  const debut = Math.floor(hier.getTime() / 1000) - 3600, fin = debut + 86400;
  const totaux: Record<string, number> = {};
  for (const m of ["reach", "views", "profile_views", "accounts_engaged", "website_clicks", "total_interactions", "likes", "comments", "saves", "shares"]) {
    try {
      const r = await igGet(`${COMPTE}/insights`, { metric: m, period: "day", metric_type: "total_value", since: debut, until: fin });
      totaux[m] = Number(r.data?.[0]?.total_value?.value ?? 0);
    } catch (e) { console.log(`::notice::compte ${m} : ${(e as Error).message.slice(0, 120)}`); }
  }
  let heures: Record<string, number> | null = null;
  try {
    const r = await igGet(`${COMPTE}/insights`, { metric: "online_followers", period: "lifetime" });
    const v = (r.data?.[0]?.values ?? []).find((x: any) => x.value && Object.keys(x.value).length);
    if (v) heures = heuresParis(v.value, v.end_time);
  } catch { /* moins de 100 abonnés ou indisponible ce jour-là */ }
  let demographie: Record<string, unknown> | null = null;
  if (paris.getDay() === 1 || TOUT) {
    demographie = {};
    for (const b of ["age", "gender", "city", "country"]) {
      try {
        const r = await igGet(`${COMPTE}/insights`, { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown: b });
        demographie[b] = Object.fromEntries((r.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? []).map((x: any) => [x.dimension_values[0], x.value]));
      } catch { /* sans gravité */ }
    }
  }
  const { error } = await supabase.from("instagram_compte").upsert({
    jour, abonnes: noeud.followers_count, portee: totaux.reach, vues: totaux.views, visites_profil: totaux.profile_views,
    comptes_engages: totaux.accounts_engaged, clics_site: totaux.website_clicks, interactions: totaux.total_interactions,
    likes: totaux.likes, commentaires: totaux.comments, enregistrements: totaux.saves, partages: totaux.shares,
    ...(heures ? { heures_en_ligne: heures } : {}), ...(demographie ? { demographie } : {}), maj_le: new Date().toISOString(),
  });
  if (error) throw new Error(`instagram_compte : ${error.message}`);
  return { jour, abonnes: noeud.followers_count as number, pseudo: ig?.pseudo };
}

async function main() {
  if (!(await instagram())) { console.log("::warning::Aucun jeton Instagram."); return; }
  const c = await compte();
  const p = await posts();
  const msg = `@${c.pseudo} : ${c.abonnes} abonnés ; ${p.n} posts relevés, ${p.photos} nouvelles photos d'âge.`;
  console.log(msg);
  await passage(AGENT, "ok", msg).catch(() => null);
}

main().then(() => process.exit(0)).catch(async e => {
  const m = String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 400);
  console.log(`::error::${m}`);
  await passage(AGENT, "panne", m).catch(() => null);
  process.exit(1);
});
