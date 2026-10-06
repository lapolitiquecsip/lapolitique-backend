import "dotenv/config";
import crypto from "crypto";
import { supabase } from "../../config/supabase.js";
import { fetchAll } from "./generate-interest-notifications.js";

/**
 * Alertes des « suivis élargis » des membres Pro : partis, ministères, candidats et
 * commissions (les élus suivis ont déjà leurs alertes de vote, generate-notifications).
 *
 *   parti      → fil du parti (entity_feed « party ») + actus du fil d'accueil qui le nomment
 *   ministere  → fil du ministère (entity_feed « ministry » : JO, communiqués)
 *   candidat   → actualités du candidat (candidate_news)
 *   commission → comptes rendus de la commission (commission_reports), « AN|Commission des lois »
 *
 * Idempotent : UNIQUE (user_id, dedup_key) en base. Catégorie « suivis » : le rythme
 * d'envoi choisi par le membre s'applique (send-notification-emails).
 * --dry : n'écrit rien.
 */
const DRY = process.argv.includes("--dry");
const JOURS = Number(process.env.SUIVIS_JOURS || 3);
const SITE_URL = process.env.SITE_URL || "https://lapolitiquecestsimple.fr";
const MAX_PAR_MEMBRE = 30;
const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’`]/g, "'");
const cle = (s: string) => crypto.createHash("md5").update(s).digest("hex").slice(0, 16);

// Actes de routine (nominations, titularisations…) : gardés dans le fil, sous le seuil
// d'envoi par défaut (importance 2) — sinon un ministère suivi noie le reste.
const ROUTINE = /^(nomination|titularisation|d[ée]l[ée]gation de signature|cessation de fonctions|admission|promotion|r[ée]int[ée]gration|d[ée]tachement|portant nomination)/i;
const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

type Alerte = { titre: string; detail: string | null; url: string | null; date: string | null; importance: number };

export async function generateSuivisNotifications() {
  const suivis = await fetchAll("user_suivis", "user_id, kind, ref, label", q => q);
  console.log(`> ${suivis.length} suivi(s) élargi(s).`);
  if (!suivis.length) return 0;
  const depuis = new Date(Date.now() - JOURS * 86400000).toISOString();

  // Contenus récents, chargés une fois pour tous les membres.
  const feed = await fetchAll("entity_feed", "entity_type, entity_id, title, summary, url, published_at, news_type",
    q => q.in("entity_type", ["party", "ministry"]).gte("published_at", depuis));
  const accueil = await fetchAll("content", "titre_simplifie, titre_original, resume_flash, source_url, date_publication",
    q => q.gte("created_at", depuis));
  const candidats = await fetchAll("candidate_news", "candidate_id, title, summary, source_url, date, news_type",
    q => q.gte("date", depuis.slice(0, 10)));
  const commissions = await fetchAll("commission_reports", "chamber, commission, title, summary, cr_url, meeting_date",
    q => q.gte("meeting_date", depuis.slice(0, 10)));
  const partis = new Map((await fetchAll("political_parties", "slug, name, abbrev", q => q)).map((p: any) => [p.slug, p]));

  const alertesDe = (kind: string, ref: string): Alerte[] => {
    if (kind === "ministere" || kind === "parti") {
      const type = kind === "ministere" ? "ministry" : "party";
      const out: Alerte[] = feed.filter((f: any) => f.entity_type === type && f.entity_id === ref)
        .map((f: any) => ({ titre: f.title, detail: f.summary, url: f.url, date: f.published_at, importance: ROUTINE.test(f.title || "") ? 2 : f.news_type === "decret" ? 4 : 3 }));
      if (kind === "parti") {
        // Le fil d'un parti est maigre : on ajoute les actus du site qui le nomment
        // (nom complet, ou sigle en majuscules comme mot entier : « RN », « LFI »).
        const p: any = partis.get(ref);
        if (p) {
          const sigle = p.abbrev && p.abbrev.length >= 2 ? new RegExp(`(^|[^A-Za-zÀ-ÿ])${p.abbrev.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-zÀ-ÿ]|$)`) : null;
          // Actualités des candidats qui nomment le parti (« Groupe RN : … »).
          for (const c of candidats) {
            if (norm(c.title || "").includes(norm(p.name)) || (sigle && sigle.test(c.title || "")))
              out.push({ titre: c.title, detail: c.summary, url: c.source_url, date: c.date, importance: 3 });
          }
          for (const c of accueil) {
            const t = `${c.titre_simplifie || c.titre_original || ""} ${c.resume_flash || ""}`;
            if (norm(t).includes(norm(p.name)) || (sigle && sigle.test(t)))
              out.push({ titre: c.titre_simplifie || c.titre_original, detail: c.resume_flash, url: c.source_url, date: c.date_publication, importance: 3 });
          }
        }
      }
      return out;
    }
    if (kind === "candidat") {
      return candidats.filter((c: any) => String(c.candidate_id) === ref)
        .map((c: any) => ({ titre: c.title, detail: c.summary, url: c.source_url, date: c.date, importance: c.news_type === "programme" ? 4 : 3 }));
    }
    if (kind === "commission") {
      const [chambre, nom] = ref.split("|");
      return commissions.filter((c: any) => c.chamber === chambre && norm(c.commission || "").startsWith(norm(nom).slice(0, 28)))
        .map((c: any) => ({ titre: c.title, detail: c.summary, url: c.cr_url || `${SITE_URL}/commissions`, date: c.meeting_date, importance: 3 }));
    }
    return [];
  };

  const maintenant = new Date().toISOString();
  const lignes: any[] = [];
  const parMembre = new Map<string, number>();
  for (const s of suivis) {
    for (const a of alertesDe(s.kind, s.ref)) {
      if (!a.titre) continue;
      if ((parMembre.get(s.user_id) || 0) >= MAX_PAR_MEMBRE) break;
      parMembre.set(s.user_id, (parMembre.get(s.user_id) || 0) + 1);
      lignes.push({
        user_id: s.user_id, type: `suivi_${s.kind}`, categorie: "suivis",
        title: majuscule(String(a.titre)).slice(0, 300), detail: a.detail ? String(a.detail).slice(0, 300) : null,
        domain: s.label.slice(0, 60), importance: a.importance, url: a.url, event_at: a.date,
        created_at: maintenant, read: false, dedup_key: `suivi|${s.kind}|${s.ref}|${cle(String(a.url || a.titre))}`,
      });
    }
  }
  console.log(`> ${lignes.length} alerte(s) de suivi pour ${parMembre.size} membre(s).`);
  if (DRY) { for (const l of lignes.slice(0, 10)) console.log(`   [${l.domain}] ${l.title.slice(0, 80)}`); return lignes.length; }
  for (let i = 0; i < lignes.length; i += 500) {
    const { error } = await supabase.from("user_notifications").upsert(lignes.slice(i, i + 500), { onConflict: "user_id,dedup_key", ignoreDuplicates: true });
    if (error) throw error;
  }
  return lignes.length;
}

if (process.argv[1] && process.argv[1].endsWith("generate-suivis-notifications.ts")) {
  generateSuivisNotifications().then(() => { process.exitCode = 0; }).catch(e => { console.error(e); process.exitCode = 1; });
}
