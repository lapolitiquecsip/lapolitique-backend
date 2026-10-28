import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { fetchAll } from "./generate-interest-notifications.js";

/**
 * Votes des partis suivis, pour les membres Pro (choix de l'user, 28/10/2026).
 *
 * Un membre Pro qui suit un parti (user_suivis, kind « parti », avec son accord RGPD) reçoit
 * ce qu'a voté le groupe de ce parti à l'Assemblée :
 *   • une alerte par VOTE IMPORTANT : vote sur l'ensemble d'un texte, motion de censure ou de
 *     rejet, déclaration du Gouvernement (art. 49-1 / 50-1) ;
 *   • les autres scrutins (amendements, articles) réunis en UNE alerte par jour — l'Assemblée
 *     en tient jusqu'à cent par jour pendant le budget.
 * Catégorie « suivis » : la cloche de l'espace Pro, et l'e-mail « Vos élus et suivis » au
 * rythme choisi. Idempotent : UNIQUE (user_id, dedup_key).
 * Les scrutins viennent du fichier ouvert de l'AN, collecté la nuit (votes-sync) : l'alerte
 * part le matin pour les votes de la veille.
 *   --dry   n'écrit rien, affiche ce qui partirait
 */
const DRY = process.argv.includes("--dry");
const JOURS = Number(process.env.VOTES_PARTIS_JOURS || 3);
const SITE_URL = process.env.SITE_URL || "https://lapolitiquecestsimple.fr";

// Groupes de la XVIIe législature, par parti (même table que src/lib/data/partyGroups.ts du site).
const GROUPES: Record<string, { po: string; court: string }> = {
  "rassemblement-national": { po: "PO845401", court: "Le RN" },
  "la-france-insoumise": { po: "PO845413", court: "LFI" },
  "parti-socialiste": { po: "PO845419", court: "Le groupe socialiste" },
  "renaissance": { po: "PO845407", court: "Ensemble pour la République" },
  "les-republicains": { po: "PO845425", court: "La Droite républicaine" },
  "les-democrates": { po: "PO845454", court: "Les Démocrates (MoDem)" },
  "horizons": { po: "PO845470", court: "Horizons" },
  "parti-communiste-francais": { po: "PO845514", court: "La GDR (communistes)" },
  "liot": { po: "PO845485", court: "Le groupe LIOT" },
  "les-ecologistes": { po: "PO845439", court: "Les Écologistes" },
  "union-des-droites": { po: "PO872880", court: "L'UDR (Ciotti)" },
};

// « article 49 » seul attrapait les amendements « à l'article 49 » d'un texte : formulations sans ambiguïté seulement.
const IMPORTANT = /motion de censure|motion de rejet|d[ée]claration du gouvernement/i;
const estImportant = (s: any) => (s.type === "LOI" && /^l'ensemble/i.test(s.title || "")) || IMPORTANT.test(`${s.title || ""} ${s.objet || ""}`);
const parisJour = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
const jourFr = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
// Vote sur l'ensemble : l'intitulé complet (« la proposition de loi visant à… »), l'objet seul
// commençant par « visant à… » ; sinon l'objet du scrutin.
const sujet = (s: any) => {
  const article: Record<string, string> = { "du ": "le ", "de la ": "la ", "de l'": "l'", "des ": "les " };
  const t = (/^l'ensemble/i.test(s.title || "") ? s.title.replace(/^l'ensemble (du |de la |de l'|des )?/i, (_m: string, a?: string) => (a ? article[a.toLowerCase()] : "")) : (s.objet || s.title || "")).trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const court = (t: string, n: number) => (t.length > n ? `${t.slice(0, t.lastIndexOf(" ", n))}…` : t);

type Pos = { cle: "pour" | "contre" | "abstention" | "partage" | "absent"; verbe: string; pour: number; contre: number; abstention: number };
function position(s: any, po: string): Pos {
  const g = (s.group_results || []).find((x: any) => x.group_id === po);
  const pour = g?.pour ?? 0, contre = g?.contre ?? 0, abstention = g?.abstention ?? 0, n = pour + contre + abstention;
  if (!n) return { cle: "absent", verbe: "n'a pas pris part au vote", pour, contre, abstention };
  const max = Math.max(pour, contre, abstention);
  if (max / n < 2 / 3) return { cle: "partage", verbe: "s'est divisé", pour, contre, abstention };
  return max === pour ? { cle: "pour", verbe: "a voté pour", pour, contre, abstention }
    : max === contre ? { cle: "contre", verbe: "a voté contre", pour, contre, abstention }
    : { cle: "abstention", verbe: "s'est abstenu", pour, contre, abstention };
}
const adopte = (s: any) => /adopt/i.test(s.resultat || "") && !/pas adopt/i.test(s.resultat || "");

async function main() {
  // Membres Pro qui suivent un parti, avec l'accord explicite (opinion politique, RGPD art. 9).
  const pros = new Set((await fetchAll("profiles", "id", q => q.eq("subscription_tier", "pro"))).map((p: any) => p.id));
  const accords = new Set((await fetchAll("user_preferences", "user_id", q => q.not("consentement_suivis", "is", null))).map((p: any) => p.user_id));
  const suivis = (await fetchAll("user_suivis", "user_id, ref", q => q.eq("kind", "parti")))
    .filter((s: any) => pros.has(s.user_id) && accords.has(s.user_id) && GROUPES[s.ref]);
  console.log(`[Votes des partis] ${suivis.length} suivi(s) de parti par des membres Pro.`);
  if (!suivis.length) return;

  const depuis = new Date(Date.now() - JOURS * 864e5).toISOString();
  const scrutins = await fetchAll("scrutins", "id, date_scrutin, title, objet, resultat, type, group_results, pour, contre, abstention",
    q => q.eq("institution", "AN").gte("date_scrutin", depuis));
  const ids = scrutins.map((s: any) => s.id);
  const dossier = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("scrutin_navette").select("scrutin_id, dossier_id").in("scrutin_id", ids.slice(i, i + 200));
    for (const n of data || []) dossier.set(n.scrutin_id, n.dossier_id);
  }
  const importants = scrutins.filter(estImportant);
  // Les autres scrutins, par jour — seulement les journées terminées, pour un décompte complet.
  const aujourdhui = parisJour(new Date());
  const parJour = new Map<string, any[]>();
  for (const s of scrutins.filter((x: any) => !estImportant(x))) {
    const j = parisJour(s.date_scrutin);
    if (j >= aujourdhui) continue;
    parJour.set(j, [...(parJour.get(j) || []), s]);
  }
  console.log(`[Votes des partis] ${scrutins.length} scrutin(s) sur ${JOURS} j : ${importants.length} important(s), ${parJour.size} journée(s) d'amendements.`);

  const lignes: any[] = [];
  for (const { user_id, ref } of suivis) {
    const g = GROUPES[ref];
    for (const s of importants) {
      const p = position(s, g.po);
      lignes.push({
        user_id, type: "vote_parti", categorie: "suivis", importance: 4, scrutin_id: s.id, position: p.cle, event_at: s.date_scrutin,
        dedup_key: `vote-parti|${ref}|${s.id}`,
        title: court(`${g.court} ${p.verbe} : ${sujet(s)}`, 180),
        detail: `${p.cle !== "absent" ? `Dans le groupe : ${p.pour} pour, ${p.contre} contre, ${p.abstention} abstention${p.abstention > 1 ? "s" : ""}. ` : ""}${adopte(s) ? "Adopté" : "Rejeté"} par l'Assemblée (${s.pour ?? "?"} pour, ${s.contre ?? "?"} contre).`,
        url: dossier.get(s.id) ? `${SITE_URL}/lois/?dossier=${dossier.get(s.id)}` : `${SITE_URL}/partis/${ref}/#votes`,
      });
    }
    for (const [jour, liste] of parJour) {
      const pos = liste.map(s => ({ s, p: position(s, g.po) }));
      const n = (k: Pos["cle"]) => pos.filter(x => x.p.cle === k).length;
      // En exemple, ce qui a changé le texte : les amendements adoptés d'abord.
      const exemples = pos.filter(x => x.p.cle !== "absent").sort((a, b) => Number(adopte(b.s)) - Number(adopte(a.s))).slice(0, 3)
        .map(x => `${court(sujet(x.s), 90)} — ${adopte(x.s) ? "adopté" : "rejeté"}, ${x.p.cle === "partage" ? "groupe divisé" : x.p.cle}`);
      lignes.push({
        user_id, type: "votes_parti_jour", categorie: "suivis", importance: 3, event_at: `${jour}T20:00:00Z`,
        dedup_key: `votes-parti-jour|${ref}|${jour}`,
        title: `${g.court} sur ${liste.length} scrutin${liste.length > 1 ? "s" : ""} le ${jourFr(jour)} : ${n("pour")} pour, ${n("contre")} contre, ${n("abstention")} abstention${n("abstention") > 1 ? "s" : ""}${n("partage") ? `, ${n("partage")} divisé${n("partage") > 1 ? "s" : ""}` : ""}`,
        detail: exemples.length ? `Dont : ${exemples.join(" · ")}.` : "Le groupe n'a pas pris part à ces scrutins.",
        url: `${SITE_URL}/partis/${ref}/#votes`,
      });
    }
  }
  console.log(`[Votes des partis] ${lignes.length} alerte(s) possible(s) (les déjà envoyées sont ignorées).`);
  if (DRY) { for (const l of lignes.slice(0, 12)) console.log(`  · [${l.importance}] ${l.title}\n      ${l.detail}`); return; }
  let ecrites = 0;
  for (let i = 0; i < lignes.length; i += 300) {
    const { data, error } = await supabase.from("user_notifications").upsert(lignes.slice(i, i + 300), { onConflict: "user_id,dedup_key", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    ecrites += (data || []).length;
  }
  console.log(`[Votes des partis] ${ecrites} nouvelle(s) alerte(s).`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
