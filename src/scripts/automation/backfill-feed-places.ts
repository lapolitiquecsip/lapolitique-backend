import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";

// Rattrapage ponctuel du LIEU des actualités de département et de région.
//
// Avant la colonne `place_scope`, un article sur UNE commune ramassé par le fil
// d'un département (« Dans cette commune de Loire-Atlantique, les élus actent la
// démolition de l'église ») partait en alerte à tout le département, sous un
// titre réécrit sans lieu : « La municipalité acte la démolition de l'église
// communale ». Ce script relit les articles récents et demande, pour chacun :
// vaut-il pour tout le territoire, ou pour une seule commune — et laquelle ?
// Il corrige au passage les titres qui disent « la municipalité » sans dire où.
//
// La suite (lieu recopié sur les alertes existantes, retrait des alertes parties
// à tort) se fait en SQL, voir la fin du fichier.
//
// Usage : npx tsx src/scripts/automation/backfill-feed-places.ts [--jours=60] [--dry]

const JOURS = Number(process.argv.find(a => a.startsWith("--jours="))?.split("=")[1] || 60);
const DRY = process.argv.includes("--dry");
const LOT = 25;

const SYSTEME = `Tu classes des actualités locales françaises publiées dans le fil d'un DÉPARTEMENT ou d'une RÉGION.
Pour chaque article (titre + résumé), réponds :
- "portee" : "territoire" pour toute DÉCISION de la préfecture, du conseil départemental ou du conseil régional (arrêté, restriction d'eau ou sécheresse sur un secteur, fermeture d'une route départementale, budget, subvention), pour une mesure générale ou qui touche plusieurs communes — MÊME si un lieu est cité ; "commune" seulement pour un fait de la vie d'UNE commune (conseil municipal, chantier municipal, église, école, commerce fermé, événement local).
- "lieu" : le nom de la commune citée dans le titre ou le résumé, quelle que soit la portée ; sinon null. N'invente JAMAIS un nom de commune.
- "titre" : seulement si le titre actuel parle d'une commune sans la nommer (« la municipalité », « la commune », « la mairie », « les élus ») : un titre corrigé qui nomme la commune si elle est connue, sinon « Une commune de <territoire> … ». Sinon null.
Réponds en JSON strict : { "articles": [ { "i": 1, "portee": "commune", "lieu": null, "titre": "…" } ] }`;

/**
 * Le lieu à afficher. Une décision départementale qui cite une commune (« le
 * secteur de Mâcon passe en crise sécheresse ») reste départementale, mais le
 * lecteur gagne à savoir où : « Mâcon (Saône-et-Loire) ».
 */
function lieuAffiche(portee: string, lieu: string | null, territoire: string): string | null {
  if (portee === "commune") return lieu;
  if (lieu && territoire && lieu !== territoire) return `${lieu} (${territoire})`;
  return territoire || lieu;
}

async function main() {
  const depuis = new Date(Date.now() - JOURS * 86400000).toISOString();
  const lignes: any[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from("entity_feed")
      .select("id, entity_type, entity_id, title, summary")
      .in("entity_type", ["department", "region"])
      .is("place_scope", null)
      .gte("published_at", depuis)
      .range(de, de + 999);
    if (error) throw error;
    lignes.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  // Le nom du territoire de chaque fil, pour la consigne et pour le lieu par défaut.
  const codes = [...new Set(lignes.map(l => (l.entity_type === "region" ? `R${l.entity_id}` : String(l.entity_id))))];
  const noms = new Map<string, string>();
  for (let i = 0; i < codes.length; i += 300) {
    const { data } = await supabase.from("territories").select("code, name").in("code", codes.slice(i, i + 300));
    for (const t of data || []) noms.set(String(t.code), t.name);
  }
  const nomDe = (l: any) => noms.get(l.entity_type === "region" ? `R${l.entity_id}` : String(l.entity_id)) || "";

  console.log(`> ${lignes.length} actualité(s) de département/région à classer (${JOURS} j).`);
  let communes = 0, territoires = 0, titres = 0, echecs = 0;

  for (let i = 0; i < lignes.length; i += LOT) {
    const lot = lignes.slice(i, i + LOT);
    const liste = lot.map((l, k) => `${k + 1}. [${nomDe(l)}] ${l.title}\n   ${String(l.summary || "").slice(0, 300)}`).join("\n");
    let reponse: any;
    try {
      const r = await resilientDeepSeek.createMessage({
        model: "deepseek-chat", max_tokens: 4000, responseFormat: "json_object",
        system: SYSTEME, messages: [{ role: "user", content: liste }],
      });
      const texte = r.content[0]?.type === "text" ? r.content[0].text : "";
      reponse = JSON.parse(texte.match(/\{[\s\S]*\}/)?.[0] || "{}");
    } catch (e: any) {
      console.warn(`  ! lot ${i / LOT + 1} : ${e.message}`);
      echecs += lot.length;
      continue;
    }

    for (const a of reponse.articles || []) {
      const l = lot[Number(a.i) - 1];
      if (!l || (a.portee !== "commune" && a.portee !== "territoire")) continue;
      const lieu = typeof a.lieu === "string" && a.lieu.trim() ? a.lieu.trim().slice(0, 80) : null;
      const maj: Record<string, unknown> = {
        place_scope: a.portee,
        place: lieuAffiche(a.portee, lieu, nomDe(l)),
      };
      if (typeof a.titre === "string" && a.titre.trim().length > 10) { maj.title = a.titre.trim().slice(0, 300); titres++; }
      if (a.portee === "commune") communes++; else territoires++;
      if (DRY) {
        if (a.portee === "commune") console.log(`   [commune${lieu ? ` : ${lieu}` : " non nommée"}] ${l.title}${maj.title ? `  →  ${maj.title}` : ""}`);
        continue;
      }
      const { error } = await supabase.from("entity_feed").update(maj).eq("id", l.id);
      if (error) { console.warn(`  ! ${l.id} : ${error.message}`); echecs++; }
    }
  }
  console.log(`--- ${DRY ? "DRY-RUN — " : ""}${territoires} pour tout le territoire, ${communes} sur une seule commune, ${titres} titre(s) corrigé(s), ${echecs} échec(s). ---`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

/*
  Suite en SQL, une fois le classement fait :

  -- 1. Les actualités de commune portent le nom de leur commune.
  update entity_feed f set place = t.name, place_scope = 'commune'
    from territories t
   where f.entity_type = 'commune' and t.code = f.entity_id and f.place is null;

  -- 2. Chaque alerte existante reçoit le lieu (et le titre corrigé) de son actualité.
  update user_notifications n set place = f.place, title = left(f.title, 300)
    from entity_feed f
   where n.type = 'local' and f.url = n.url
     and f.entity_type in ('commune', 'department', 'region') and f.place is not null;

  -- 3. Retrait des alertes parties à tort : article d'un fil de département ou de
  --    région sur UNE commune, envoyé à quelqu'un qui n'y habite pas (ou commune
  --    non nommée).
  delete from user_notifications n
   using entity_feed f
   where n.type = 'local' and f.url = n.url
     and f.entity_type in ('department', 'region') and f.place_scope = 'commune'
     and not exists (
       select 1 from user_preferences p
        where p.user_id = n.user_id and f.place is not null
          and extensions.unaccent(lower(trim(p.city))) = extensions.unaccent(lower(trim(f.place))));
*/
