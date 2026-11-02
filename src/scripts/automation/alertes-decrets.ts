import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { fetchAll } from "./generate-interest-notifications.js";

/**
 * Alertes sur les décrets d'application, pour les membres Pro qui suivent une loi
 * (user_suivis, kind « app_loi », ref = jorf_id). Après chaque relevé du baromètre :
 *   - un texte d'application est paru (décret ou arrêté) : la mesure est passée de « en attente » à « appliqué » depuis la dernière alerte ;
 *   - une échéance vient de passer sans décret, dans les 7 derniers jours (jamais tout l'historique de la
 *     loi à qui vient de la suivre). Les publications « éventuelles » n'ont pas d'échéance à manquer.
 * Une alerte par loi et par nature. Idempotent : UNIQUE (user_id, dedup_key).
 *   --dry   n'écrit rien, affiche ce qui partirait
 */
const DRY = process.argv.includes("--dry");
const SITE_URL = process.env.SITE_URL || "https://lapolitiquecestsimple.fr";
const court = (t: string, n: number) => (t.length > n ? `${t.slice(0, t.lastIndexOf(" ", n))}…` : t);
const dateFr = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

async function main() {
  const pros = new Set((await fetchAll("profiles", "id", q => q.eq("subscription_tier", "pro"))).map((p: any) => p.id));
  const suivis = (await fetchAll("user_suivis", "user_id, ref, label, cree_le", q => q.eq("kind", "app_loi"))).filter((s: any) => pros.has(s.user_id));
  console.log(`[Alertes décrets] ${suivis.length} loi(s) suivie(s) par des membres Pro.`);
  if (!suivis.length) return;

  const refs = [...new Set(suivis.map((s: any) => s.ref))] as string[];
  const mesures: any[] = [];
  for (let i = 0; i < refs.length; i += 100) {
    mesures.push(...await fetchAll("application_mesures", "loi_jorf_id, ordre, objet, articles, etat, echeance, eventuelle, applique_vu_le, decret_id",
      q => q.in("loi_jorf_id", refs.slice(i, i + 100))));
  }
  const lois = new Map<string, any>();
  for (let i = 0; i < refs.length; i += 200) {
    const { data } = await supabase.from("application_lois").select("jorf_id, titre").in("jorf_id", refs.slice(i, i + 200));
    for (const l of data || []) lois.set(l.jorf_id, l);
  }
  const dernieres = await fetchAll("user_notifications", "user_id, dedup_key, event_at", q => q.eq("categorie", "decrets").like("dedup_key", "app|paru|%"));
  const derniere = new Map<string, number>();
  for (const n of dernieres as any[]) {
    const cle = `${n.user_id}|${n.dedup_key.split("|")[2]}`;
    derniere.set(cle, Math.max(derniere.get(cle) || 0, Date.parse(n.event_at)));
  }

  const aujourdhui = new Date().toISOString().slice(0, 10);
  const ilYa7Jours = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const lignes: any[] = [];
  for (const s of suivis as any[]) {
    const titre = court(lois.get(s.ref)?.titre || s.label, 110);
    const url = `${SITE_URL}/premium/?app-loi=${encodeURIComponent(s.ref)}#decrets`;
    const delaLoi = mesures.filter(m => m.loi_jorf_id === s.ref);
    const objet = (m: any) => `${m.articles ? `${m.articles} : ` : ""}${court(m.objet || "mesure sans intitulé", 140)}`;
    const fin = (t: string) => (t.endsWith("…") ? t : `${t}.`);

    const depuis = derniere.get(`${s.user_id}|${s.ref}`) || Date.parse(s.cree_le);
    const parus = delaLoi.filter(m => m.applique_vu_le && Date.parse(m.applique_vu_le) > depuis);
    if (parus.length) {
      const dernier = parus.map(m => m.applique_vu_le).sort().pop();
      lignes.push({
        user_id: s.user_id, type: "decrets", categorie: "decrets", importance: 4, event_at: dernier, url,
        dedup_key: `app|paru|${s.ref}|${dernier}`,
        title: court(`${parus.length > 1 ? `${parus.length} textes d'application parus` : "Texte d'application paru"} : ${titre}`, 180),
        detail: fin(`${parus.slice(0, 3).map(objet).join(" · ")}${parus.length > 3 ? ` · et ${parus.length - 3} autre(s)` : ""}`),
      });
    }
    const dateSuivi = String(s.cree_le).slice(0, 10);
    const manques = delaLoi.filter(m => m.etat === "attente" && !m.eventuelle && m.echeance && m.echeance < aujourdhui && m.echeance >= ilYa7Jours && m.echeance >= dateSuivi);
    if (manques.length) {
      const date = manques.map(m => m.echeance).sort().pop();
      lignes.push({
        user_id: s.user_id, type: "decrets", categorie: "decrets", importance: 4, event_at: `${date}T12:00:00Z`, url,
        dedup_key: `app|retard|${s.ref}|${date}`,
        title: court(`Échéance dépassée, ${manques.length > 1 ? `${manques.length} mesures` : "une mesure"} sans texte recensé : ${titre}`, 180),
        detail: fin(`Prévue au plus tard le ${dateFr(date)}. ${manques.slice(0, 3).map(objet).join(" · ")}${manques.length > 3 ? ` · et ${manques.length - 3} autre(s)` : ""}`),
      });
    }
  }
  console.log(`[Alertes décrets] ${lignes.length} alerte(s).`);
  if (DRY) { for (const l of lignes.slice(0, 10)) console.log(`  · ${l.title}\n      ${l.detail}`); return; }
  for (let i = 0; i < lignes.length; i += 300) {
    const { error } = await supabase.from("user_notifications").upsert(lignes.slice(i, i + 300), { onConflict: "user_id,dedup_key", ignoreDuplicates: true });
    if (error) throw error;
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
