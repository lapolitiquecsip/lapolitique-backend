import "dotenv/config";
import * as cheerio from "cheerio";
import { supabase } from "../../config/supabase.js";

/**
 * Sondages de la présidentielle 2027, relevés sur la liste tenue sur Wikipédia
 * (« Liste de sondages sur l'élection présidentielle française de 2027 »), mise à
 * jour dans les heures qui suivent chaque publication et sourcée sondage par sondage.
 *
 * Premier tour : un tableau par semestre ; une ligne par hypothèse testée, les
 * cellules institut / dates / échantillon couvrant (rowspan) les lignes d'un même
 * sondage. Second tour : un tableau par duel. Les dates n'ont pas toujours leur
 * année : elle vient du titre de section, ou de l'ordre des lignes (antichronologique).
 *
 * Un nouveau sondage de premier tour déclenche une alerte dans l'espace des abonnés.
 * SONDAGES_SANS_ALERTE=1 : import initial, sans alerte.
 */

const PAGE = "Liste_de_sondages_sur_l'élection_présidentielle_française_de_2027";
const SOURCE = `https://fr.wikipedia.org/wiki/${encodeURIComponent(PAGE)}`;
const UA = "lapolitiquecestsimple/1.0 (https://lapolitiquecestsimple.fr ; lapolitiquecsimple@gmail.com)";

const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const MOIS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6,
  juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, sep: 9, octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, dec: 12,
};

type Resultat = { nom: string; slug: string | null; pct: number; complet?: string; photo?: string | null };
type Ligne = { cle: string; tour: 1 | 2; institut: string; date_debut: string | null; date_fin: string; echantillon: number | null; hypothese: number; resultats: Resultat[] };

/** Tableau HTML → grille, rowspan et colspan dépliés. */
function grille($: cheerio.CheerioAPI, table: any): string[][] {
  const g: string[][] = [];
  $(table).find("tr").each((r, tr) => {
    g[r] ||= [];
    let c = 0;
    $(tr).children("td,th").each((_, cell) => {
      while (g[r][c] !== undefined) c++;
      const $c = $(cell);
      $c.find("sup.reference, .reference, style").remove();
      // Plusieurs candidats dans une même cellule (colonne « Autres ») : séparés par un filet.
      $c.find("hr").replaceWith(" ¦ ");
      const texte = $c.text().replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
      const rs = Math.max(1, parseInt($c.attr("rowspan") || "1", 10) || 1);
      const cs = Math.max(1, parseInt($c.attr("colspan") || "1", 10) || 1);
      for (let i = 0; i < rs; i++) for (let k = 0; k < cs; k++) { (g[r + i] ||= [])[c + k] = texte; }
      c += cs;
    });
  });
  return g;
}

/** « 25-29 septembre », « 30 sept.-2 oct. 2026 », « 1er-3 octobre » → [début, fin]. */
function dates(txt: string, anneeParDefaut: number, plafond: Date): [string | null, string] | null {
  // On isole les jours, mois et années dans l'ordre où ils apparaissent.
  const toks = norm(txt.replace(/1er/g, "1")).split(/\s+/);
  const jours: number[] = [], mois: number[] = [], ans: number[] = [];
  for (const k of toks) {
    if (/^\d{4}$/.test(k)) ans.push(+k);
    else if (/^\d{1,2}$/.test(k)) jours.push(+k);
    else if (MOIS[k] || MOIS[k.slice(0, 4)] || MOIS[k.slice(0, 3)]) mois.push(MOIS[k] || MOIS[k.slice(0, 4)] || MOIS[k.slice(0, 3)]);
  }
  if (!jours.length || !mois.length) return null;
  const jf = jours[jours.length - 1], mf = mois[mois.length - 1];
  let af = ans.length ? ans[ans.length - 1] : anneeParDefaut;
  let fin = new Date(Date.UTC(af, mf - 1, jf));
  // Sans année explicite, une date « dans le futur » appartient à l'année précédente.
  if (!ans.length && fin.getTime() > plafond.getTime() + 3 * 86400000) { af -= 1; fin = new Date(Date.UTC(af, mf - 1, jf)); }
  const jd = jours[0], md = mois.length > 1 ? mois[0] : mf;
  let ad = ans.length > 1 ? ans[0] : af;
  if (md > mf && ans.length <= 1) ad = af - 1;
  const debut = jours.length > 1 ? new Date(Date.UTC(ad, md - 1, jd)) : null;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return [debut ? iso(debut) : null, iso(fin)];
}

const nombre = (s: string): number | null => {
  const m = (s || "").replace(/\s/g, "").match(/^<?(\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
};

type Fiche = { slug: string | null; complet: string; photo: string | null };

/**
 * Reconnaît une personne testée dans un sondage d'après le nom affiché (souvent le
 * seul nom de famille). D'abord les fiches candidats, quel que soit leur statut
 * (Hollande ou Bardella ne sont pas candidats mais sont testés) ; ensuite les autres
 * fiches d'élus et de ministres, pour le nom complet et la photo — à condition
 * qu'un seul élu porte ce nom, faute de quoi on ne devine pas.
 */
async function personnes() {
  const parNom = new Map<string, Fiche>();
  const ajouter = (complet: string, fiche: Fiche, ecraser: boolean) => {
    const n = norm(complet); const mots = n.split(" ");
    const cles = [n, ...mots.slice(1).map((_, i) => mots.slice(i + 1).join(" "))];
    for (const k of cles) if (ecraser || !parNom.has(k)) parNom.set(k, fiche);
  };
  const { data: cands } = await supabase.from("presidential_candidates").select("slug, full_name, photo_url");
  for (const c of cands || []) ajouter(c.full_name, { slug: c.slug, complet: c.full_name, photo: c.photo_url }, false);

  // Autres fiches : un nom de famille porté par deux personnes différentes est écarté.
  const autres = new Map<string, Fiche | null>();
  const proposer = (complet: string, photo: string | null) => {
    if (!complet) return;
    const n = norm(complet); const mots = n.split(" ");
    for (const k of [n, ...mots.slice(1).map((_, i) => mots.slice(i + 1).join(" "))]) {
      const deja = autres.get(k);
      if (deja === undefined) autres.set(k, { slug: null, complet, photo });
      else if (deja && norm(deja.complet) !== n) autres.set(k, null);
    }
  };
  for (const [table, champs] of [["minister_profiles", "full_name, photo_url"], ["meps", "full_name, photo_url"], ["presidents", "full_name, photo_url"]] as const) {
    const { data } = await supabase.from(table).select(champs);
    for (const r of (data || []) as any[]) proposer(r.full_name, r.photo_url);
  }
  for (const table of ["deputies", "senators"]) {
    const { data } = await supabase.from(table).select("first_name, last_name, photo_url").limit(2000);
    for (const r of (data || []) as any[]) proposer(`${r.first_name} ${r.last_name}`, r.photo_url);
  }
  for (const [k, f] of autres) if (f && !parNom.has(k)) parNom.set(k, f);
  return (nom: string): Fiche | null => parNom.get(norm(nom)) ?? null;
}

/**
 * Personnalités testées sans fiche sur le site : nom complet donné ici (un nom de
 * famille seul ne suffit pas à chercher sans risque — « Rousseau »), photo prise
 * sur leur article Wikipédia.
 */
const HORS_FICHES: Record<string, string> = {
  "villepin": "Dominique de Villepin", "le maire": "Bruno Le Maire", "villiers": "Philippe de Villiers",
  "delga": "Carole Delga", "lassalle": "Jean Lassalle", "poutou": "Philippe Poutou", "rousseau": "Sandrine Rousseau",
};
async function photoWikipedia(titre: string): Promise<string | null> {
  try {
    const r = await fetch(`https://fr.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=thumbnail&pithumbsize=250&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(titre)}`, { headers: { "User-Agent": UA } });
    const j: any = await r.json();
    return j?.query?.pages?.[0]?.thumbnail?.source ?? null;
  } catch { return null; }
}

/** « Glucksmann(PP) », « CandidatRN » → nom affichable. */
const libelle = (s: string) => s.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").trim();

async function main() {
  const rep = await fetch(`https://fr.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(PAGE)}&prop=text|revid&format=json&formatversion=2`, { headers: { "User-Agent": UA } });
  if (!rep.ok) throw new Error(`Wikipédia : HTTP ${rep.status}`);
  const j: any = await rep.json();
  const $ = cheerio.load(j.parse.text);
  const ficheDe = await personnes();
  const horsFiches = new Map<string, Fiche>();
  for (const [k, complet] of Object.entries(HORS_FICHES)) horsFiches.set(k, { slug: null, complet, photo: await photoWikipedia(complet) });
  const maintenant = new Date();

  const lignes: Ligne[] = [];
  let section2 = false, annee = maintenant.getUTCFullYear(), titre = "";
  $("h2, h3, h4, table.wikitable").each((_, el) => {
    if (el.tagName !== "table") {
      const t = $(el).text();
      if (/second tour/i.test(t)) section2 = true;
      else if (/premier tour/i.test(t)) section2 = false;
      const a = t.match(/20\d\d/); if (a) annee = +a[0];
      titre = t.replace(/\[.*$/, "").trim();
      return;
    }
    if (/^autres$/i.test(titre)) return;   // hypothèses anciennes hors candidats (Macron…)
    const g = grille($, el);
    if (g.length < 4) return;
    // Ligne d'en-tête des noms courts : la première qui contient « (PARTI) » ou, au
    // second tour, la deuxième ligne.
    const iEntete = g.findIndex((r, i) => i > 0 && r.slice(3).some(x => /\(/.test(x || "")));
    if (iEntete < 0) return;
    const entete = g[iEntete];
    const tour: 1 | 2 = section2 ? 2 : 1;
    let anneeCourante = tour === 1 ? annee : maintenant.getUTCFullYear();
    let plafond = tour === 1 ? new Date(Date.UTC(annee, 11, 31)) : maintenant;
    if (plafond > maintenant) plafond = maintenant;
    const parSondage = new Map<string, number>();

    for (let r = iEntete + 1; r < g.length; r++) {
      const row = g[r]; if (!row || row.length < 5) continue;
      const institut = (row[0] || "").trim();
      if (!institut || /sondeur/i.test(institut)) continue;
      const d = dates(row[1] || "", anneeCourante, plafond);
      if (!d) continue;
      // Ordre antichronologique : la ligne suivante n'est pas plus récente que celle-ci.
      plafond = new Date(d[1] + "T00:00:00Z"); anneeCourante = plafond.getUTCFullYear();
      const echantillon = nombre((row[2] || "").replace(/\s/g, ""));

      const vus = new Map<string, Resultat>();
      for (let c = 3; c < entete.length; c++) {
        const col = libelle(entete[c] || "");
        if (!col || /^(blanc|abst|nsp)/i.test(norm(col))) continue;
        // « Autres » regroupe des petits candidats nommés dans la cellule (Lisnard, Ruffin…).
        const autres = /^autres?$/i.test(col);
        for (const brut of (row[c] || "").split("¦").map(x => x.trim())) {
          const pct = nombre(brut);
          if (pct == null) continue;
          // « 36Bardella » : la colonne (CandidatRN) porte le nom du candidat testé.
          const nomCellule = libelle(brut.replace(/^<?\s*[\d.,]+\s*%?/, ""));
          const nomme = !!nomCellule && /^[A-ZÉ]/.test(nomCellule);
          if (autres && !nomme) continue;   // total des « autres » sans nom : pas un candidat
          const nom = (nomme ? nomCellule : col).replace(/^Candidat(?=[A-Z])/, "Candidat ");
          const cle = norm(nom);
          if (vus.has(cle)) continue;   // colonne fusionnée (colspan) : même candidat
          const f = /^Candidat /.test(nom) ? null : ficheDe(nom) ?? horsFiches.get(norm(nom)) ?? null;
          vus.set(cle, { nom, slug: f?.slug ?? null, pct, ...(f ? { complet: f.complet, photo: f.photo } : {}) });
        }
      }
      const resultats = [...vus.values()].sort((a, b) => b.pct - a.pct);
      if (resultats.length < 2) continue;
      const total = resultats.reduce((s, x) => s + x.pct, 0);
      if (total < 60 || total > 140) continue;   // ligne de notes ou mal lue

      const idSondage = `${norm(institut)}|${d[1]}`;
      const hyp = (parSondage.get(idSondage) || 0) + 1; parSondage.set(idSondage, hyp);
      const duel = tour === 2 ? resultats.map(x => x.slug || norm(x.nom)).sort().join("-") : "";
      lignes.push({
        cle: tour === 1 ? `${idSondage}|1|h${hyp}` : `${idSondage}|2|${duel}`,
        tour, institut, date_debut: d[0], date_fin: d[1], echantillon, hypothese: tour === 1 ? hyp : 1, resultats,
      });
    }
  });

  // Doublons de clé (même duel publié deux fois dans la page) : la première lecture gagne.
  const uniques = [...new Map(lignes.map(l => [l.cle, l])).values()];
  console.log(`[Sondages] ${uniques.length} hypothèse(s) lue(s) : ${uniques.filter(l => l.tour === 1).length} au 1er tour, ${uniques.filter(l => l.tour === 2).length} au 2nd.`);
  if (uniques.length < 20) throw new Error("Lecture anormalement maigre : la structure de la page a peut-être changé.");
  if (process.env.SONDAGES_DRY === "1") {
    for (const l of uniques.slice(0, 12)) console.log(l.cle, l.date_debut, l.echantillon, l.resultats.map(x => `${x.nom}${x.slug ? "" : "?"} ${x.pct}`).join(" · "));
    for (const l of uniques.filter(x => x.tour === 2).slice(0, 6)) console.log(l.cle, l.resultats.map(x => `${x.nom} ${x.pct}`).join(" · "));
    const inconnus = new Set(uniques.flatMap(l => l.resultats.filter(x => !x.slug).map(x => x.nom)));
    console.log("Sans fiche :", [...inconnus].join(", "));
    const parAn = uniques.reduce((m: any, l) => (m[l.date_fin.slice(0, 7)] = (m[l.date_fin.slice(0, 7)] || 0) + 1, m), {});
    console.log("Par mois :", JSON.stringify(parAn));
    return;
  }

  const { data: existants } = await supabase.from("sondages").select("cle");
  const connues = new Set((existants || []).map(e => e.cle));
  const sansAlerte = process.env.SONDAGES_SANS_ALERTE === "1";
  const rows = uniques.map(l => ({ ...l, source_url: SOURCE, maj_le: new Date().toISOString(), ...(connues.has(l.cle) ? {} : { notifie: sansAlerte }) }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("sondages").upsert(rows.slice(i, i + 200), { onConflict: "cle" });
    if (error) throw error;
  }
  console.log(`[Sondages] ${rows.filter(r => !connues.has(r.cle)).length} nouvelle(s) hypothèse(s).`);

  await alerter();
}

/** Un sondage de 1er tour récent et pas encore annoncé → une alerte par abonné. */
async function alerter() {
  const depuis = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const { data: nouveaux } = await supabase.from("sondages").select("id, institut, date_debut, date_fin, hypothese, resultats, tour")
    .eq("notifie", false).eq("tour", 1).gte("date_fin", depuis).order("hypothese");
  const parSondage = new Map<string, any[]>();
  for (const s of nouveaux || []) { const k = `${s.institut}|${s.date_fin}`; parSondage.set(k, [...(parSondage.get(k) || []), s]); }
  if (!parSondage.size) { await marquer(); return; }

  const { data: abonnes } = await supabase.from("profiles").select("id").in("subscription_tier", ["elite", "pro"]);
  const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  const rows: any[] = [];
  for (const [k, hyps] of parSondage) {
    const h1 = hyps[0];
    const tete = (h1.resultats as Resultat[]).slice(0, 3).map(x => `${x.nom.split(" ").pop()} ${String(x.pct).replace(".", ",")} %`).join(", ");
    const titre = `Nouveau sondage ${h1.institut} : ${tete}`;
    const detail = `Présidentielle 2027, premier tour — enquête réalisée ${h1.date_debut ? `du ${fmt(h1.date_debut)} ` : ""}au ${fmt(h1.date_fin)}${hyps.length > 1 ? `, ${hyps.length} hypothèses testées` : ""}.`;
    for (const u of abonnes || []) rows.push({
      user_id: u.id, type: "sondage", title: titre.slice(0, 300), detail, domain: "institutions", importance: 4,
      url: "/presidentielles-2027/#sondages", event_at: h1.date_fin, read: false, dedup_key: `sondage:${k}`,
    });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("user_notifications").upsert(rows.slice(i, i + 500), { onConflict: "user_id,dedup_key", ignoreDuplicates: true });
    if (error) { console.warn(`[Sondages] alertes : ${error.message}`); return; }
  }
  console.log(`[Sondages] ${parSondage.size} nouveau(x) sondage(s) annoncé(s) à ${(abonnes || []).length} abonné(s).`);
  await marquer();
}

async function marquer() {
  await supabase.from("sondages").update({ notifie: true }).eq("notifie", false);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
