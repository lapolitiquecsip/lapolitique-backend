import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { chargerAMO10, mandatDepute, groupeDe, historiquePolitique, parElectionPartielle, resultat2024, PARTI_BASE } from "../../lib/fiche-an.js";

// Roster AUTORITAIRE des députés en fonction — dataset officiel AN « députés actifs » (AMO10).
// Détecte les départs (décès, démission, nomination au gouvernement → remplacement par le
// suppléant…) : un député de notre base absent du roster actif AN → sitting=false ; présent → true.
// Source fiable (contrairement au CSV datan, incomplet). Garde-fou : on n'écrit rien si le roster
// récupéré est anormalement petit (téléchargement partiel). DRY_RUN=1 = compte seulement.
//
// Crée aussi la fiche des nouveaux entrants dès leur prise de fonction : avant, ils n'arrivaient
// qu'avec le CSV de Datan, des semaines plus tard, et sans historique ni résultat électoral.
// Les fiches sans historique politique ou sans résultat 2024 sont complétées au passage.

const slugify = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

async function main() {
  const dry = process.env.DRY_RUN === "1";
  console.log("Téléchargement du roster des députés actifs (AN)…");
  const an = await chargerAMO10();
  const active = new Set(an.acteurs.keys());
  console.log(`Roster actif AN : ${active.size} députés.`);
  // Garde-fou : l'AN compte 577 sièges. En dessous de 500, le téléchargement est douteux → on abandonne.
  if (active.size < 500) throw new Error(`Roster actif anormalement petit (${active.size}) — abandon pour ne pas flaguer à tort.`);

  const { data: deputies, error } = await supabase.from("deputies")
    .select("id, an_id, slug, first_name, last_name, department, constituency_number, political_history, election_score, party, party_color");
  if (error) throw error;

  const sitting: string[] = [], gone: { id: string; name: string }[] = [];
  for (const d of deputies || []) {
    if (d.an_id && active.has(d.an_id.trim())) sitting.push(d.id);
    else gone.push({ id: d.id, name: `${d.first_name} ${d.last_name}` });
  }
  console.log(`En fonction : ${sitting.length} · sortis : ${gone.length}`);
  for (const g of gone) console.log(`  - sorti : ${g.name}`);

  // Nouveaux entrants : en fonction à l'AN, absents de la base.
  const connus = new Set((deputies || []).map(d => (d.an_id || "").trim()));
  const slugs = new Set((deputies || []).map(d => d.slug));
  const nouveaux = [...an.acteurs.entries()].filter(([uid]) => !connus.has(uid)).map(([uid, a]) => {
    const ident = a.etatCivil?.ident ?? {}, m = mandatDepute(a), lieu = m?.election?.lieu ?? {};
    const prenom = String(ident.prenom || "").trim(), nom = String(ident.nom || "").trim();
    let slug = slugify(`${prenom} ${nom}`);
    if (slugs.has(slug)) slug = `${slug}-${uid.replace("PA", "")}`;   // homonyme
    slugs.add(slug);
    const gp = groupeDe(a, an), parti = gp?.abrev ? PARTI_BASE[gp.abrev] : undefined;
    const departement = typeof lieu.departement === "string" ? lieu.departement : null;
    const circo = Number(lieu.numCirco) || null;
    return {
      an_id: uid, first_name: prenom, last_name: nom, slug,
      party: parti?.party ?? gp?.abrev ?? null, party_color: parti?.color ?? null,
      department: departement, constituency_number: circo,
      photo_url: `https://www.assemblee-nationale.fr/dyn/static/tribun/17/photos/carre/${uid.replace("PA", "")}.jpg`,
      date_prise_fonction: typeof m?.mandature?.datePriseFonction === "string" ? m.mandature.datePriseFonction : null,
      job: typeof a.profession?.libelleCourant === "string" ? a.profession.libelleCourant : null,
      political_history: historiquePolitique(a, an),
      election_score: departement && circo && !parElectionPartielle(a) ? resultat2024(departement, circo) : null,
      sitting: true,
    };
  });
  for (const n of nouveaux) console.log(`  + nouveau : ${n.first_name} ${n.last_name} (${n.department} ${n.constituency_number}e, ${n.party}, depuis le ${n.date_prise_fonction})`);

  // Fiches existantes en fonction à compléter : historique ou résultat électoral manquant.
  const aCompleter = (deputies || []).filter(d => d.an_id && active.has(d.an_id.trim()) && (!d.political_history || !d.election_score));

  // Groupe politique : rien ne le remettait à jour après la création de la fiche. Un député
  // entré « non inscrit » le jour de sa prise de fonction, ou qui change de groupe, gardait
  // l'ancien. L'appartenance officielle (mandat GP en cours) fait foi.
  const groupes: { id: string; nom: string; avant: string | null; party: string; color: string }[] = [];
  for (const d of deputies || []) {
    const a = d.an_id ? an.acteurs.get(d.an_id.trim()) : null;
    const abrev = a ? groupeDe(a, an)?.abrev : null;
    const cible = abrev ? PARTI_BASE[abrev] : undefined;
    if (cible && (d.party !== cible.party || d.party_color !== cible.color))
      groupes.push({ id: d.id, nom: `${d.first_name} ${d.last_name}`, avant: d.party, party: cible.party, color: cible.color });
  }
  for (const g of groupes.filter(x => x.avant !== x.party)) console.log(`  ~ groupe : ${g.nom} ${g.avant} → ${g.party}`);
  console.log(`Groupes à aligner : ${groupes.length} (dont ${groupes.filter(x => x.avant !== x.party).length} changement(s) de groupe, le reste = couleur/orthographe).`);

  if (dry) { console.log(`(DRY_RUN : aucune écriture — ${nouveaux.length} nouveau(x), ${aCompleter.length} fiche(s) à compléter)`); return; }

  const update = async (ids: string[], value: boolean) => {
    for (let i = 0; i < ids.length; i += 200) {
      const { error: e } = await supabase.from("deputies").update({ sitting: value }).in("id", ids.slice(i, i + 200));
      if (e) throw e;
    }
  };
  await update(sitting, true);
  await update(gone.map(g => g.id), false);

  if (nouveaux.length) {
    const { error: e } = await supabase.from("deputies").insert(nouveaux);
    if (e) throw e;
  }

  for (const g of groupes) {
    const { error: e } = await supabase.from("deputies").update({ party: g.party, party_color: g.color }).eq("id", g.id);
    if (e) console.warn(`  ! groupe ${g.nom} : ${e.message}`);
  }

  let completes = 0;
  for (const d of aCompleter) {
    const a = an.acteurs.get(d.an_id.trim());
    const maj: Record<string, unknown> = {};
    if (!d.political_history) maj.political_history = historiquePolitique(a, an);
    // Le résultat 2024 vaut pour un suppléant devenu député (élu en binôme), pas pour l'élu d'une partielle.
    if (!d.election_score && d.department && d.constituency_number && !parElectionPartielle(a)) {
      const r = resultat2024(d.department, d.constituency_number);
      if (r) maj.election_score = r;
    }
    if (!Object.keys(maj).length) continue;
    const { error: e } = await supabase.from("deputies").update(maj).eq("id", d.id);
    if (e) console.warn(`  ! ${d.first_name} ${d.last_name} : ${e.message}`); else completes++;
  }
  console.log(`--- TERMINÉ. ${sitting.length + nouveaux.length} en fonction (${nouveaux.length} nouveau(x)), ${gone.length} marqué(s) sortis, ${completes} fiche(s) complétée(s). ---`);
}

main().catch(e => { console.error(e); process.exit(1); });
