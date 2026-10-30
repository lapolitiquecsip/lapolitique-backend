import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { fetchAll } from "../automation/generate-interest-notifications.js";

/**
 * Relie chaque amendement tranché en séance au scrutin public qui l'a tranché (30/10/2026).
 *
 * L'Assemblée vote la plupart des amendements à main levée : aucun décompte par député n'est
 * publié. Quand un scrutin public a lieu, son objet le désigne en clair : « l'amendement n° 29
 * de M. Bloch à l'article premier de la proposition de loi visant à… », « le sous-amendement
 * n° 70 de M. Bernhardt à l'amendement n° 2 de M. Tryzna… », « les amendements identiques
 * n° 12 de M. X et n° 45 de Mme Y… ». On rapproche : le numéro ET le nom de l'auteur, dans la
 * TÊTE de l'objet (avant « à l'amendement / à l'article… », sinon un sous-amendement serait
 * pris pour l'amendement qu'il modifie), puis le texte et la date pour départager.
 *
 * amendements_an.scrutin_id = le scrutin (deputy_votes donne alors le vote de chaque député) ;
 * vote_mode = 'scrutin_public' | 'main_levee' (séance, sort connu depuis 2 jours, aucun scrutin)
 * | 'commission' (voté en commission : pas de scrutin public).
 *   --dry   n'écrit rien
 */
const DRY = process.argv.includes("--dry");
const JOURS = Number(process.argv.find(a => a.startsWith("--jours="))?.split("=")[1] || 30);
const sansAccent = (t: string) => (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&nbsp;| /g, " ");
const COUPE = /\s(?:a|au|aux|apres|avant)\s(?:l['’]\s?)?(?:amendement|article|annexe|titre|chapitre|etat|ensemble)\b/;
const numeros = (tete: string) => new Set([...tete.matchAll(/n[°o]\s*([a-z0-9]+(?:-[a-z0-9]+)*)/gi)].map(m => m[1].toLowerCase()));
const motsTexte = (t: string) => new Set(sansAccent(t).split(/[^a-z0-9]+/).filter(m => m.length >= 5));

async function main() {
  const depuis = new Date(Date.now() - JOURS * 864e5).toISOString();
  const amdts = await fetchAll("amendements_an", "uid, numero, auteur, texte_titre, organe, sort, sort_le, vu_le, vote_mode",
    q => q.in("sort", ["Adopté", "Rejeté"]).is("scrutin_id", null).or(`sort_le.gte.${depuis},sort_le.is.null`));
  const aTraiter = amdts.filter((a: any) => a.vote_mode !== "commission");
  console.log(`[Votes d'amendements] ${aTraiter.length} amendement(s) tranché(s) sans scrutin relié.`);
  if (!aTraiter.length) return;

  const scrutins = await fetchAll("scrutins", "id, objet, date_scrutin", q => q.eq("type", "AMENDEMENT").gte("date_scrutin", new Date(Date.now() - (JOURS + 30) * 864e5).toISOString()));
  const fiches = scrutins.map((s: any) => {
    const o = sansAccent(s.objet || "");
    const tete = o.split(COUPE)[0];
    return { id: s.id, date: new Date(s.date_scrutin).getTime(), tete, nums: numeros(tete), objet: o };
  });
  console.log(`[Votes d'amendements] ${fiches.length} scrutin(s) public(s) d'amendement en regard.`);

  let publics = 0, mainLevee = 0, commission = 0;
  const maj: { uid: string; scrutin_id: string | null; vote_mode: string }[] = [];
  for (const a of aTraiter) {
    if (!/s[ée]ance/i.test(a.organe || "")) { maj.push({ uid: a.uid, scrutin_id: null, vote_mode: "commission" }); commission++; continue; }
    // « I-2121 » (budget : partie du texte) s'écrit « n° 2121 » dans l'objet du scrutin.
    const num = String(a.numero || "").toLowerCase().replace(/\s*\(.*$/, "").replace(/^(?:i{1,3}|iv)-/, "").trim();
    const nom = sansAccent(String(a.auteur || "").replace(/^(m\.|mme|m)\s+/i, "")).split(/\s+/).pop() || "";
    const quand = new Date(a.sort_le || a.vu_le).getTime();
    let cands = fiches.filter(f => f.nums.has(num) && (!nom || f.tete.includes(nom)) && Math.abs(f.date - quand) < 20 * 864e5);
    if (cands.length > 1) {
      const mots = motsTexte(a.texte_titre || "");
      const score = (f: typeof fiches[0]) => [...mots].filter(m => f.objet.includes(m)).length;
      const max = Math.max(...cands.map(score));
      cands = cands.filter(f => score(f) === max);
    }
    const choisi = cands.sort((x, y) => Math.abs(x.date - quand) - Math.abs(y.date - quand))[0];
    if (choisi) { maj.push({ uid: a.uid, scrutin_id: choisi.id, vote_mode: "scrutin_public" }); publics++; }
    else if (a.sort_le && Date.now() - new Date(a.sort_le).getTime() > 2 * 864e5) {
      if (a.vote_mode !== "main_levee") { maj.push({ uid: a.uid, scrutin_id: null, vote_mode: "main_levee" }); mainLevee++; }
    }
  }
  console.log(`[Votes d'amendements] scrutin public : ${publics} · main levée : ${mainLevee} · commission : ${commission}.`);
  if (DRY) { for (const m of maj.filter(x => x.scrutin_id).slice(0, 8)) console.log(`  ${m.uid} → ${m.scrutin_id}`); return; }
  // Par paquets de même valeur (un scrutin, ou un mode sans scrutin) : des milliers de lignes
  // une à une prenaient dix minutes au premier passage.
  const paquets = new Map<string, string[]>();
  for (const m of maj) { const k = `${m.scrutin_id ?? ""}|${m.vote_mode}`; paquets.set(k, [...(paquets.get(k) || []), m.uid]); }
  for (const [k, uids] of paquets) {
    const [scrutin_id, vote_mode] = k.split("|");
    for (let i = 0; i < uids.length; i += 200) {
      const { error } = await supabase.from("amendements_an").update({ scrutin_id: scrutin_id || null, vote_mode }).in("uid", uids.slice(i, i + 200));
      if (error) console.log(`  ! ${k} : ${error.message}`);
    }
  }
  console.log(`[Votes d'amendements] ${maj.length} amendement(s) mis à jour.`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
