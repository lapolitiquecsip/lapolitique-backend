import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { fetchAll } from "./generate-interest-notifications.js";

/**
 * Alertes d'amendements, pour les membres Pro (demande de l'user, 30/10/2026).
 *
 * Un membre Pro suit un TEXTE (user_suivis, kind « amdt_texte », ref = texte_uid de l'AN) ou un
 * GROUPE politique (kind « amdt_groupe », ref = amendements_an.groupe, avec son accord RGPD :
 * opinion politique). Après chaque relevé horaire (sync-amendements-an), les amendements
 * apparus depuis la dernière alerte lui arrivent en UNE alerte par suivi : le nombre, trois
 * exemples, et le lien vers l'outil filtré. Catégorie « amendements » : envoyée par e-mail
 * tout de suite (send-notification-emails --mode=immediat) et dans la cloche de l'espace Pro.
 * Idempotent : UNIQUE (user_id, dedup_key), la clé porte le dernier amendement vu.
 *   --dry   n'écrit rien, affiche ce qui partirait
 */
const DRY = process.argv.includes("--dry");
const SITE_URL = process.env.SITE_URL || "https://lapolitiquecestsimple.fr";
const court = (t: string, n: number) => (t.length > n ? `${t.slice(0, t.lastIndexOf(" ", n))}…` : t);
// Exposés relevés avec leurs entités HTML ; auteurs de commission notés « rapporteur null ».
const propre = (t: string | null) => (t || "").replace(/&amp;/g, "&").replace(/&nbsp;|&#160;/g, " ").replace(/&#0?39;|&rsquo;/g, "’").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/\s*null/g, "").replace(/\s+/g, " ").trim();

async function main() {
  const pros = new Set((await fetchAll("profiles", "id", q => q.eq("subscription_tier", "pro"))).map((p: any) => p.id));
  const accords = new Set((await fetchAll("user_preferences", "user_id", q => q.not("consentement_suivis", "is", null))).map((p: any) => p.user_id));
  const suivis = (await fetchAll("user_suivis", "user_id, kind, ref, label, cree_le", q => q.in("kind", ["amdt_texte", "amdt_groupe"])))
    .filter((s: any) => pros.has(s.user_id) && (s.kind === "amdt_texte" || accords.has(s.user_id)));
  console.log(`[Alertes amendements] ${suivis.length} suivi(s) de texte ou de groupe par des membres Pro.`);
  if (!suivis.length) return;

  // Depuis quand : la dernière alerte de ce suivi, sinon le moment où il a été créé (jamais
  // l'historique entier d'un texte à qui vient de s'y abonner).
  const { data: dernieres } = await supabase.from("user_notifications").select("user_id, dedup_key, event_at")
    .eq("categorie", "amendements").gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString()).limit(20000);
  const derniere = new Map<string, string>();
  for (const n of dernieres || []) {
    const cle = `${n.user_id}|${n.dedup_key.split("|").slice(1, 3).join("|")}`;
    if (!derniere.has(cle) || n.event_at > derniere.get(cle)!) derniere.set(cle, n.event_at);
  }
  const depuisDe = (s: any) => derniere.get(`${s.user_id}|${s.kind}|${s.ref}`) || s.cree_le;
  const plusAncien = suivis.map(depuisDe).sort()[0];

  const amdts = await fetchAll("amendements_an", "uid, numero, texte_uid, texte_titre, division, organe, auteur, groupe, expose, vu_le",
    q => q.gt("vu_le", plusAncien).or(`texte_uid.in.(${[...new Set(suivis.filter((s: any) => s.kind === "amdt_texte").map((s: any) => s.ref))].join(",") || "aucun"}),groupe.in.(${[...new Set(suivis.filter((s: any) => s.kind === "amdt_groupe").map((s: any) => `"${s.ref}"`))].join(",") || "aucun"})`));
  console.log(`[Alertes amendements] ${amdts.length} amendement(s) nouveau(x) sur les textes et groupes suivis.`);

  const lignes: any[] = [];
  for (const s of suivis) {
    const depuis = depuisDe(s);
    const liste = amdts.filter((a: any) => a.vu_le > depuis && (s.kind === "amdt_texte" ? a.texte_uid === s.ref : a.groupe === s.ref))
      .sort((a: any, b: any) => (a.vu_le < b.vu_le ? 1 : -1));
    if (!liste.length) continue;
    const n = liste.length, pluriel = n > 1 ? "s" : "";
    const dernier = liste[0].vu_le;
    const textes = [...new Set(liste.map((a: any) => a.texte_titre).filter(Boolean))];
    const titre = s.kind === "amdt_texte"
      ? `${n > 1 ? `${n} nouveaux` : "Un nouvel"} amendement${pluriel} sur « ${court(liste[0].texte_titre || s.label, 110)} »`
      : `${s.ref} : ${n} amendement${pluriel} déposé${pluriel}${textes.length === 1 ? ` sur « ${court(textes[0], 90)} »` : textes.length ? ` sur ${textes.length} textes` : ""}`;
    const exemples = liste.slice(0, 3).map((a: any) =>
      `n° ${a.numero} (${propre(a.auteur) || "auteur inconnu"}${s.kind === "amdt_texte" && a.groupe ? `, ${a.groupe}` : ""}${a.division ? `, ${propre(a.division)}` : ""})${a.expose ? ` : ${court(propre(a.expose), 140)}` : ""}`);
    const filtre = s.kind === "amdt_texte" ? `amdt-texte=${encodeURIComponent(s.ref)}` : `amdt-groupe=${encodeURIComponent(s.ref)}`;
    lignes.push({
      user_id: s.user_id, type: "amendements", categorie: "amendements", importance: 4, event_at: dernier,
      dedup_key: `amdt|${s.kind}|${s.ref}|${dernier}`,
      title: court(titre, 180),
      detail: `${exemples.join(" · ")}${n > 3 ? ` · et ${n - 3} autre${n - 3 > 1 ? "s" : ""}.` : "."}`,
      url: `${SITE_URL}/premium/?${filtre}#amendements`,
    });
  }
  console.log(`[Alertes amendements] ${lignes.length} alerte(s) à envoyer.`);
  if (DRY) { for (const l of lignes.slice(0, 12)) console.log(`  · ${l.title}\n      ${l.detail}\n      ${l.url}`); return; }
  let ecrites = 0;
  for (let i = 0; i < lignes.length; i += 300) {
    const { data, error } = await supabase.from("user_notifications").upsert(lignes.slice(i, i + 300), { onConflict: "user_id,dedup_key", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    ecrites += (data || []).length;
  }
  console.log(`[Alertes amendements] ${ecrites} nouvelle(s) alerte(s).`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
