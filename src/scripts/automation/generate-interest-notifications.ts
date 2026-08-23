import "dotenv/config";
import crypto from "crypto";
import { supabase } from "../../config/supabase.js";
import { matchDomains } from "../../lib/interest-domains.js";

// Notifications PERSONNALISÉES des membres premium.
// À partir des NOUVEAUX contenus produits par les automatisations du site (flux `entity_feed`),
// on rattache chaque info à un/des domaines (mots-clés) et on notifie uniquement les membres
// concernés selon leur profil (`user_preferences`) :
//   - contenu NATIONAL (ministère)  → match par CENTRE D'INTÉRÊT (interests ∩ domaines de l'info) ;
//   - contenu LOCAL (commune/dept)  → match par LOCALISATION (département) ET centre d'intérêt.
// Idempotent : UNIQUE(user_id, dedup_key). Écrit dans `user_notifications` (colonnes domain/importance/url).
//
// Options : `--dry` = n'insère rien, journalise seulement. `--test` = ajoute un profil synthétique
// (tous intérêts, dept 34) pour valider le matching quand aucun membre n'a encore de profil.

const LOOKBACK_DAYS = Number(process.env.INTEREST_NOTIF_LOOKBACK_DAYS || 3);
const MAX_PER_USER = Number(process.env.INTEREST_NOTIF_MAX_PER_USER || 25);
const DRY = process.argv.includes("--dry");
const TEST = process.argv.includes("--test");

const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// Importance (1..5) selon le type d'actualité.
const IMPORTANCE_BY_TYPE: Record<string, number> = {
  loi: 5, decision: 4, decret: 4, budget: 4, mesure: 4, projet: 3, actualite: 3, annonce: 3,
  lancement: 3, equipement: 3, bilan: 3, travaux: 2, evenement: 2, conseil_municipal: 2, nomination: 2,
};
const importanceOf = (newsType: string | null) => IMPORTANCE_BY_TYPE[String(newsType || "").toLowerCase()] ?? 3;

// Code département depuis un texte libre (nom ou numéro) saisi par le membre.
const DEPARTMENTS: Record<string, string> = {
  "01": "ain", "02": "aisne", "03": "allier", "04": "alpes-de-haute-provence", "05": "hautes-alpes",
  "06": "alpes-maritimes", "07": "ardeche", "08": "ardennes", "09": "ariege", "10": "aube", "11": "aude",
  "12": "aveyron", "13": "bouches-du-rhone", "14": "calvados", "15": "cantal", "16": "charente",
  "17": "charente-maritime", "18": "cher", "19": "correze", "2a": "corse-du-sud", "2b": "haute-corse",
  "21": "cote-d-or", "22": "cotes-d-armor", "23": "creuse", "24": "dordogne", "25": "doubs", "26": "drome",
  "27": "eure", "28": "eure-et-loir", "29": "finistere", "30": "gard", "31": "haute-garonne", "32": "gers",
  "33": "gironde", "34": "herault", "35": "ille-et-vilaine", "36": "indre", "37": "indre-et-loire",
  "38": "isere", "39": "jura", "40": "landes", "41": "loir-et-cher", "42": "loire", "43": "haute-loire",
  "44": "loire-atlantique", "45": "loiret", "46": "lot", "47": "lot-et-garonne", "48": "lozere",
  "49": "maine-et-loire", "50": "manche", "51": "marne", "52": "haute-marne", "53": "mayenne",
  "54": "meurthe-et-moselle", "55": "meuse", "56": "morbihan", "57": "moselle", "58": "nievre", "59": "nord",
  "60": "oise", "61": "orne", "62": "pas-de-calais", "63": "puy-de-dome", "64": "pyrenees-atlantiques",
  "65": "hautes-pyrenees", "66": "pyrenees-orientales", "67": "bas-rhin", "68": "haut-rhin", "69": "rhone",
  "70": "haute-saone", "71": "saone-et-loire", "72": "sarthe", "73": "savoie", "74": "haute-savoie",
  "75": "paris", "76": "seine-maritime", "77": "seine-et-marne", "78": "yvelines", "79": "deux-sevres",
  "80": "somme", "81": "tarn", "82": "tarn-et-garonne", "83": "var", "84": "vaucluse", "85": "vendee",
  "86": "vienne", "87": "haute-vienne", "88": "vosges", "89": "yonne", "90": "territoire-de-belfort",
  "91": "essonne", "92": "hauts-de-seine", "93": "seine-saint-denis", "94": "val-de-marne", "95": "val-d-oise",
  "971": "guadeloupe", "972": "martinique", "973": "guyane", "974": "la-reunion", "976": "mayotte",
};
const NAME_TO_CODE = new Map(Object.entries(DEPARTMENTS).map(([code, name]) => [name, code]));

function userDeptCode(dep: string | null): string | null {
  const raw = (dep || "").trim();
  if (!raw) return null;
  if (/^\d{2,3}$/i.test(raw) || /^2[ab]$/i.test(raw)) return raw.toLowerCase();          // saisi en numéro
  const key = norm(raw).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return NAME_TO_CODE.get(key) || null;                                                    // saisi en nom
}

// Département d'un item local : code direct (department) ou 2 premiers chiffres de l'INSEE (commune).
function itemDeptCode(entityType: string, entityId: string): string | null {
  const id = String(entityId || "");
  if (entityType === "department") return id.toLowerCase();
  if (entityType === "commune") {
    if (/^97[1-6]/.test(id)) return id.slice(0, 3);   // DOM : 3 chiffres
    if (/^2[ab]/i.test(id)) return id.slice(0, 2).toLowerCase();
    if (/^\d{5}$/.test(id)) return id.slice(0, 2);    // métropole : 2 chiffres
  }
  return null;
}

async function fetchAll(table: string, select: string, apply: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await apply(supabase.from(table).select(select)).range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function generateInterestNotifications() {
  console.log(`--- NOTIFICATIONS PERSONNALISÉES ${DRY ? "(DRY-RUN) " : ""}---`);

  // 1) Membres avec un profil (intérêts et/ou localisation renseignés).
  const prefs = await fetchAll("user_preferences",
    "user_id, interests, region, department, city, notify_email, email_min_importance", q => q);
  const users = prefs
    .map(p => ({ ...p, deptCode: userDeptCode(p.department), interests: (p.interests || []) as string[] }))
    .filter(u => u.interests.length > 0 || u.deptCode);
  if (TEST) users.push({ user_id: "00000000-0000-0000-0000-000000000000", interests: ["economie", "securite", "ecologie", "sante", "logement", "agriculture"], region: null, department: "34", city: null, notify_email: true, email_min_importance: 3, deptCode: "34" } as any);
  console.log(`> ${users.length} membre(s) avec profil.`);
  if (!users.length) { console.log("--- Aucun profil. Rien à faire. ---"); return 0; }

  // 2) Nouveaux contenus du flux d'automatisations.
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const items = await fetchAll("entity_feed",
    "entity_type, entity_id, title, summary, url, published_at, news_type",
    q => q.gte("published_at", since).order("published_at", { ascending: false }));
  console.log(`> ${items.length} contenu(s) sur ${LOOKBACK_DAYS} j.`);

  const now = new Date().toISOString();
  const perUser = new Map<string, number>();
  const rows: any[] = [];

  for (const it of items) {
    const domains = matchDomains(`${it.title || ""} ${it.summary || ""}`);
    if (!domains.length) continue;                          // rien à quoi rattacher
    const isLocal = it.entity_type === "commune" || it.entity_type === "department";
    const itDept = isLocal ? itemDeptCode(it.entity_type, it.entity_id) : null;
    const importance = importanceOf(it.news_type);
    const dedup = `feed|${crypto.createHash("md5").update(String(it.url || it.title)).digest("hex").slice(0, 16)}`;

    for (const u of users) {
      const inter = domains.filter(d => u.interests.includes(d));
      if (isLocal) {
        if (!itDept || u.deptCode !== itDept) continue;     // pas dans son département
        if (u.interests.length && !inter.length) continue;  // filtre par intérêt SEULEMENT s'il en a coché
      } else {
        if (!inter.length) continue;                        // national : match par intérêt
      }
      if ((perUser.get(u.user_id) || 0) >= MAX_PER_USER) continue;
      perUser.set(u.user_id, (perUser.get(u.user_id) || 0) + 1);
      rows.push({
        user_id: u.user_id, type: isLocal ? "local" : "info",
        title: String(it.title || "").slice(0, 300),
        detail: it.summary ? String(it.summary).slice(0, 300) : null,
        domain: inter[0] || domains[0], importance, url: it.url || null,
        event_at: it.published_at || null, created_at: now, read: false, dedup_key: dedup,
      });
    }
  }

  console.log(`> ${rows.length} notification(s) candidate(s) pour ${perUser.size} membre(s).`);
  if (DRY || TEST) {
    for (const r of rows.slice(0, 15)) console.log(`   [${r.importance}] (${r.domain}/${r.type}) ${r.title.slice(0, 70)}`);
    if (DRY) { console.log("--- DRY-RUN : rien inséré. ---"); return rows.length; }
  }
  if (!rows.length) { console.log("--- Aucune notification. ---"); return 0; }

  // 3) Upsert idempotent (user_id, dedup_key).
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error, count } = await supabase
      .from("user_notifications")
      .upsert(rows.slice(i, i + 500), { onConflict: "user_id,dedup_key", ignoreDuplicates: true, count: "exact" });
    if (error) { console.error("[InterestNotif] upsert:", error.message); throw error; }
    inserted += count ?? 0;
  }
  console.log(`--- TERMINE. ${inserted} nouvelle(s) notification(s). ---`);
  return inserted;
}

if (process.argv[1] && process.argv[1].endsWith("generate-interest-notifications.ts")) {
  generateInterestNotifications().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
