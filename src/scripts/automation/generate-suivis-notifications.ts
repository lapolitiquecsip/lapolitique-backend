import "dotenv/config";
import crypto from "crypto";
import { supabase } from "../../config/supabase.js";
import { fetchAll } from "./generate-interest-notifications.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

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

/* ───────────── Tri éditorial (partis et candidats) ─────────────
 * Un membre Pro ne veut pas « l'avis de quelqu'un sur une news » : seulement les FAITS
 * dont l'entité qu'il suit est l'acteur. Grille fixe, appliquée par l'IA une fois par item :
 *   5  candidature officielle ou retrait, programme publié, alliance/fusion/rupture,
 *      résultat électoral, mise en examen/condamnation/relaxe, démission ou désignation d'un dirigeant
 *   4  proposition concrète (mesure, chiffrage, texte déposé), congrès/primaire/investiture,
 *      position officielle sur un texte en discussion au Parlement, lancement de campagne
 *   3  déclaration ou interview sans annonce nouvelle, déplacement, meeting ordinaire
 *   2  petite phrase, polémique verbale, réponse à une attaque
 *   1  avis ou réaction d'un TIERS, analyse, éditorial, portrait, sondage
 * Récap e-mail : nature « fait », acteur = l'entité suivie, importance ≥ 4.
 */
const GRILLE = `Tu tries l'actualité pour un abonné qui suit une organisation ou une personnalité politique. Il ne veut QUE les faits importants dont CETTE entité est l'acteur (elle décide, annonce, propose, est désignée, est poursuivie ou jugée…), jamais l'avis d'un tiers sur elle.

Pour chaque item, renvoie :
- "nature" : "fait" (décision, annonce, acte, procédure judiciaire, résultat) | "declaration" (propos sans annonce nouvelle) | "reaction" (quelqu'un commente, critique, réagit) | "analyse" (éditorial, décryptage, portrait) | "sondage".
- "acteur" : true seulement si l'entité suivie est l'auteur du fait ou son sujet direct (sa candidature, sa mise en examen…). Un tiers qui parle d'elle → false.
- "importance" (1-5) :
  5 = candidature officielle ou retrait, programme publié, alliance/fusion/rupture, résultat électoral, mise en examen/condamnation/relaxe, démission ou désignation d'un dirigeant ;
  4 = proposition concrète (mesure précise, chiffrage, texte déposé), congrès/primaire/investiture, position officielle sur un texte au Parlement, lancement de campagne ;
  3 = déclaration ou interview sans annonce nouvelle, déplacement, meeting ordinaire ;
  2 = petite phrase, polémique verbale, réponse à une attaque ;
  1 = avis ou réaction d'un tiers, analyse, portrait, sondage.
- "raison" : 8 mots maximum.
- "evenement" : le FAIT D'ORIGINE dont parle l'article, en une phrase neutre de 14 mots maximum, attribuée à sa source quand c'est une révélation ou une accusation (« Mediapart attribue à Jordan Bardella des écrits antisémites »). Deux articles sur le même fait ont le même "evenement", mot pour mot. N'emploie que des noms et chiffres présents dans le titre ou le résumé.
Réponds en JSON strict : { "items": [ { "i": 0, "nature": "fait", "acteur": true, "importance": 4, "raison": "...", "evenement": "..." } ] }`;

const AVIS_REGLE = /\b(selon|estime|juge|dénonce|fustige|tacle|réagit|commente|critique|accuse|s'en prend|tribune|édito|chronique|analyse|décryptage|portrait|sondage|qu'en pensez|faut-il)\b|\?\s*$|^[«"]/i;
const FAIT_FORT = /(candidat(ure)?|investi|programme|alliance|fusion|rupture|mis(e)? en examen|condamn|relax|d[ée]mission|[ée]lu|d[ée]sign[ée]|congr[eè]s|primaire|propos(e|ition)|d[ée]pose|annonce|lance)/i;

type Verdict = { importance: number; nature: string; acteur: boolean; raison?: string; methode: string; evenement?: string | null };

/** Secours sans IA : prudent (rien n'atteint 4 sans motif fort, et jamais un avis). */
function regles(entite: string, titre: string): Verdict {
  if (AVIS_REGLE.test(titre)) return { importance: 1, nature: "reaction", acteur: false, methode: "regles" };
  const nomme = norm(titre).includes(norm(entite).split(/[ (—-]/)[0]);
  return { importance: nomme && FAIT_FORT.test(titre) ? 4 : 2, nature: nomme ? "fait" : "declaration", acteur: nomme, methode: "regles" };
}

async function trier(items: { cle: string; entite: string; titre: string; detail: string | null }[]): Promise<Map<string, Verdict>> {
  const res = new Map<string, Verdict>();
  if (!items.length) return res;
  for (let k = 0; k < items.length; k += 200) {
    const { data: connus } = await supabase.from("tri_suivis").select("cle, importance, nature, acteur, raison, methode, evenement").in("cle", items.slice(k, k + 200).map(i => i.cle));
    // Jugés avant l'ajout de l'« événement » : rejugés une fois.
    for (const c of connus || []) if (c.evenement) res.set(c.cle, c as Verdict);
  }
  const neufs = items.filter(i => !res.has(i.cle));
  for (let k = 0; k < neufs.length; k += 15) {
    const lot = neufs.slice(k, k + 15);
    const contenu = lot.map((x, i) => `[${i}] Entité suivie : ${x.entite}\nTitre : ${x.titre}${x.detail ? `\nRésumé : ${String(x.detail).slice(0, 300)}` : ""}`).join("\n\n");
    let verdicts: any[] | null = null;
    for (const payant of [false, true]) {
      try {
        const r = await resilientDeepSeek.createMessage({
          model: "deepseek-chat", max_tokens: 4000, responseFormat: "json_object", sansReflexion: true,
          system: GRILLE, messages: [{ role: "user", content: contenu }],
        }, { payant, timeoutMs: 60000 });
        const t = r.content?.[0]?.type === "text" ? r.content[0].text : "";
        verdicts = JSON.parse(t.match(/\{[\s\S]*\}/)?.[0] || "{}").items || null;
        if (verdicts) break;
      } catch { /* gratuit saturé → payant ; payant indisponible → règles */ }
    }
    const lignes = lot.map((x, i) => {
      const v = verdicts?.find((y: any) => Number(y.i) === i);
      const verdict: Verdict = v && Number(v.importance) >= 1
        ? { importance: Math.min(5, Math.max(1, Number(v.importance))), nature: String(v.nature || "declaration"), acteur: !!v.acteur, raison: v.raison ? String(v.raison).slice(0, 120) : undefined, methode: "ia", evenement: v.evenement ? String(v.evenement).slice(0, 160) : null }
        : regles(x.entite, x.titre);
      res.set(x.cle, verdict);
      return { cle: x.cle, entite: x.entite.slice(0, 120), titre: x.titre.slice(0, 300), ...verdict };
    });
    // Le secours « règles » n'est pas mis en cache : l'IA rejugera au prochain passage.
    const aGarder = lignes.filter(l => l.methode === "ia");
    if (aGarder.length && !DRY) await supabase.from("tri_suivis").upsert(aGarder, { onConflict: "cle" });
  }
  return res;
}

/** Part des mots significatifs communs à deux phrases (0 à 1). */
function motsCommuns(a: string, b: string): number {
  const mots = (t: string) => new Set(norm(t).split(/[^a-z0-9]+/).filter(m => m.length > 3));
  const x = mots(a), y = mots(b);
  if (!x.size || !y.size) return 0;
  return [...x].filter(m => y.has(m)).length / Math.min(x.size, y.size);
}

/**
 * Regroupe les articles d'une entité par fait d'origine (« evenement » donné par le tri).
 * Retient les faits commentés par 3 articles au moins dont aucun n'est déjà une alerte
 * (importance ≥ 4), et dont la formulation est vérifiable : chaque nom propre et chaque
 * chiffre de l'« evenement » figure dans un des titres du groupe.
 */
function evenementsSansFait(items: { a: Alerte; v: Verdict | undefined }[]) {
  const groupes: { evenement: string; membres: { a: Alerte; v: Verdict }[] }[] = [];
  for (const it of items) {
    const e = it.v?.evenement;
    if (!e || !it.v) continue;
    const g = groupes.find(x => motsCommuns(x.evenement, e) >= 0.6);
    if (g) g.membres.push({ a: it.a, v: it.v }); else groupes.push({ evenement: e, membres: [{ a: it.a, v: it.v }] });
  }
  return groupes.filter(g => g.membres.length >= 3 && !g.membres.some(m => importanceTriee(m.v) >= 4)).filter(g => {
    const titres = norm(g.membres.map(m => `${m.a.titre} ${m.a.detail || ""}`).join(" "));
    const nomsEtChiffres = (g.evenement.match(/\b([A-ZÉÈÀ][\wéèêàçïî'-]{2,}|\d+(?:[.,]\d+)?)/g) || []).slice(1);   // le 1er mot porte la majuscule de phrase
    return nomsEtChiffres.every(x => titres.includes(norm(x)));
  }).map(g => {
    // Source : l'article le plus factuel du groupe, le plus ancien à égalité.
    const rang = (m: { v: Verdict }) => (m.v.nature === "fait" ? 0 : m.v.nature === "declaration" ? 1 : 2);
    const source = [...g.membres].sort((x, y) => rang(x) - rang(y) || String(x.a.date).localeCompare(String(y.a.date)))[0].a;
    return { evenement: g.evenement, n: g.membres.length, source };
  });
}

/** Importance retenue : plafonnée à 2 si ce n'est pas un fait dont l'entité suivie est l'acteur. */
const importanceTriee = (v: Verdict) => (v.nature === "fait" && v.acteur ? v.importance : Math.min(v.importance, 2));

export async function generateSuivisNotifications() {
  // Partis et candidats : seulement avec l'accord explicite du membre (opinion politique, RGPD art. 9).
  const accords = new Set((await fetchAll("user_preferences", "user_id", q => q.not("consentement_suivis", "is", null))).map((p: any) => p.user_id));
  const suivis = (await fetchAll("user_suivis", "user_id, kind, ref, label", q => q))
    .filter((s: any) => !["parti", "candidat"].includes(s.kind) || accords.has(s.user_id));
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
        // Seul le travail législatif compte : examen ou adoption d'un texte ou d'un rapport,
        // audition d'un ministre. Bureau, tables rondes, nominations de rapporteurs : non.
        .map((c: any) => {
          const t = `${c.title || ""} ${c.summary || ""}`;
          const fort = /(examen|adopt|projet de loi|proposition de loi|rapport d'information|audition de (m\.|mme|monsieur|madame) [^,.;]{0,80}ministre)/i.test(t)
            && !/^(nomination|d[ée]signation)|bureau de (la commission|l.assembl)|[ée]lection du bureau|composition du bureau/i.test(String(c.title || "").trim());
          const titre = String(c.title || "").length > 110 ? `${String(c.title).slice(0, 110).replace(/\s+\S*$/, "")}…` : c.title;
          return { titre, detail: c.summary, url: c.cr_url || `${SITE_URL}/commissions`, date: c.meeting_date, importance: fort ? 4 : 2 };
        });
    }
    return [];
  };

  // Tri éditorial des partis et candidats, une fois par item (cache tri_suivis).
  const aTrier = new Map<string, { cle: string; entite: string; titre: string; detail: string | null }>();
  const cleTri = (s: any, a: Alerte) => cle(`${s.kind}|${s.ref}|${a.url || a.titre}`);
  for (const s of suivis) if (s.kind === "parti" || s.kind === "candidat")
    for (const a of alertesDe(s.kind, s.ref)) if (a.titre) aTrier.set(cleTri(s, a), { cle: cleTri(s, a), entite: s.label, titre: String(a.titre), detail: a.detail });
  const verdicts = await trier([...aTrier.values()]);
  console.log(`> ${aTrier.size} actu(s) de partis/candidats triée(s) : ${[...verdicts.values()].filter(v => importanceTriee(v) >= 4).length} jugée(s) importante(s).`);

  const maintenant = new Date().toISOString();
  const reNotes: { user_id: string; dedup_key: string; importance: number }[] = [];
  const lignes: any[] = [];
  const parMembre = new Map<string, number>();
  for (const s of suivis) {
    for (const a0 of alertesDe(s.kind, s.ref)) {
      if (!a0.titre) continue;
      const v = (s.kind === "parti" || s.kind === "candidat") ? verdicts.get(cleTri(s, a0)) : undefined;
      const a = v ? { ...a0, importance: importanceTriee(v) } : a0;
      // Une alerte déjà créée garde sa clé : sa note suit le tri (même à la baisse).
      if (v) reNotes.push({ user_id: s.user_id, dedup_key: `suivi|${s.kind}|${s.ref}|${cle(String(a.url || a.titre))}`, importance: a.importance });
      // Avis, réactions, analyses : pas d'alerte du tout.
      if (a.importance < 3) continue;
      if ((parMembre.get(s.user_id) || 0) >= MAX_PAR_MEMBRE) break;
      parMembre.set(s.user_id, (parMembre.get(s.user_id) || 0) + 1);
      lignes.push({
        user_id: s.user_id, type: `suivi_${s.kind}`, categorie: "suivis",
        title: majuscule(String(a.titre)).slice(0, 300), detail: a.detail ? String(a.detail).slice(0, 300) : null,
        domain: s.label.slice(0, 60), importance: a.importance, url: a.url, event_at: a.date,
        created_at: maintenant, read: false, dedup_key: `suivi|${s.kind}|${s.ref}|${cle(String(a.url || a.titre))}`,
      });
    }

    // Le fait derrière les réactions : quand 3 articles ou plus commentent un même fait
    // et qu'aucun n'a été retenu, une seule ligne neutre donne le fait d'origine.
    if (s.kind === "parti" || s.kind === "candidat") {
      for (const g of evenementsSansFait(alertesDe(s.kind, s.ref).filter(a => a.titre).map(a => ({ a, v: verdicts.get(cleTri(s, a)) })))) {
        if ((parMembre.get(s.user_id) || 0) >= MAX_PAR_MEMBRE) break;
        parMembre.set(s.user_id, (parMembre.get(s.user_id) || 0) + 1);
        lignes.push({
          user_id: s.user_id, type: `suivi_${s.kind}`, categorie: "suivis",
          title: majuscule(g.evenement).slice(0, 300), detail: `Fait commenté par ${g.n} articles cette semaine. Source citée : ${g.source.titre}`.slice(0, 300),
          domain: s.label.slice(0, 60), importance: 4, url: g.source.url, event_at: g.source.date,
          created_at: maintenant, read: false, dedup_key: `evt|${s.kind}|${s.ref}|${cle(norm(g.evenement))}`,
        });
      }
    }
  }
  console.log(`> ${lignes.length} alerte(s) de suivi pour ${parMembre.size} membre(s).`);
  if (DRY) { for (const l of lignes.slice(0, 10)) console.log(`   [${l.domain}] ${l.title.slice(0, 80)}`); return lignes.length; }
  for (let i = 0; i < lignes.length; i += 500) {
    const { error } = await supabase.from("user_notifications").upsert(lignes.slice(i, i + 500), { onConflict: "user_id,dedup_key", ignoreDuplicates: true });
    if (error) throw error;
  }
  // Notes réécrites sur les alertes existantes (groupées par membre et par note).
  const groupes = new Map<string, string[]>();
  for (const r of reNotes) { const k = `${r.user_id}|${r.importance}`; groupes.set(k, [...(groupes.get(k) || []), r.dedup_key]); }
  for (const [k, cles] of groupes) {
    const [uid, imp] = k.split("|");
    for (let i = 0; i < cles.length; i += 100)
      await supabase.from("user_notifications").update({ importance: Number(imp) }).eq("user_id", uid).in("dedup_key", cles.slice(i, i + 100)).neq("importance", Number(imp));
  }
  return lignes.length;
}

if (process.argv[1] && process.argv[1].endsWith("generate-suivis-notifications.ts")) {
  generateSuivisNotifications().then(() => { process.exitCode = 0; }).catch(e => { console.error(e); process.exitCode = 1; });
}
