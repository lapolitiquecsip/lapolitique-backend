import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { resilientDeepSeek } from "../../lib/deepseek-client.js";
import { dureeEtSousTitres, transcrireGemini } from "../../lib/transcription.js";

/**
 * Résumé des vidéos des candidats (chaîne officielle) et de leurs débats télévisés, à
 * partir de ce qui est RÉELLEMENT dit : transcription (sous-titres, sinon Gemini), puis
 * résumé factuel attribué (« Marine Le Pen annonce… »). Garde-fou anti-fausse info :
 * un résumé dont un chiffre n'apparaît pas dans la transcription est rejeté.
 * Remplace, dans le récap Pro et sur le site, la description publicitaire des chaînes.
 *
 * Usage : npx tsx src/scripts/data/resumer-videos.ts [--jours=7] [--max=12]
 */
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split("=")[1];
const JOURS = Number(arg("jours") || 7);
const MAX = Number(arg("max") || 12);

const SYS = `On te donne la transcription automatique d'une vidéo politique (intervention, meeting, interview ou débat) d'une personnalité candidate à la présidentielle. Écris un RÉSUMÉ FACTUEL de ce qui y est dit.

RÈGLES :
- 2 à 4 phrases, 450 caractères maximum, en français courant.
- Résume UNIQUEMENT ce que dit la personnalité indiquée (débat ou émission à plusieurs : les autres intervenants ne sont cités que s'ils sont indispensables, en quelques mots).
- Commence par ce qui est NOUVEAU : annonces, propositions chiffrées, prises de position nettes.
- Attribue toujours : « [Nom] annonce… », « [Nom] propose… », « [Nom] estime que… » (jamais « Selon [Nom], il… »). Jamais une affirmation du candidat présentée comme un fait.
- Orthographe des noms : utilise la liste de personnalités fournie (les sous-titres déforment les noms : « Morel » pour « Maurel »).
- Aucun chiffre, nom ou fait absent de la transcription. Un passage douteux (erreur de sous-titres) n'est pas utilisé.
- Neutre : aucun adjectif de jugement, aucune attaque reprise à son compte.
- Si la vidéo ne contient rien de substantiel (simple appel au vote, clip, extrait de quelques secondes), réponds "resume": null.
JSON strict : { "resume": "… ou null" }`;

const nombres = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) || []).map(n => n.replace(",", "."));
function chiffresPresents(resume: string, transcription: string): boolean {
  const dispo = new Set(nombres(transcription.replace(/\s(?=\d{3}\b)/g, "")));
  return nombres(resume).every(n => dispo.has(n) || n.length <= 1);
}

let NOMS = "";
async function resumer(nom: string, titre: string, texte: string): Promise<string | null> {
  for (const payant of [false, true]) {
    try {
      const r = await resilientDeepSeek.createMessage({
        model: "deepseek-chat", max_tokens: 800, responseFormat: "json_object", sansReflexion: true, system: SYS,
        messages: [{ role: "user", content: `Personnalité : ${nom}\nNoms connus (orthographe exacte) : ${NOMS}\nTitre de la vidéo : ${titre}\n\nTRANSCRIPTION :\n${texte.slice(0, 60000)}` }],
      }, { payant, timeoutMs: 120000 });
      const t = r.content?.[0]?.type === "text" ? r.content[0].text : "";
      const j = JSON.parse(t.match(/\{[\s\S]*\}/)?.[0] || "{}");
      if (j.resume === null) return "";
      if (typeof j.resume === "string" && j.resume.length > 40) return j.resume.slice(0, 600);
    } catch { /* gratuit saturé → payant */ }
  }
  return null;
}

async function main() {
  const depuis = new Date(Date.now() - JOURS * 864e5).toISOString();
  const { data: cands } = await supabase.from("presidential_candidates").select("id, full_name");
  const nomDe = new Map((cands || []).map((c: any) => [c.id, c.full_name]));
  NOMS = (cands || []).map((c: any) => c.full_name).join(", ");
  const { data: videos } = await supabase.from("candidate_videos").select("video_id, candidate_id, title, url, published_at")
    .is("resume_le", null).gte("published_at", depuis).order("published_at", { ascending: false }).limit(MAX);
  const { data: debats } = await supabase.from("candidate_debates").select("source_key, candidate_id, title, url, date, video_id")
    .is("resume_le", null).not("video_id", "is", null).gte("date", depuis.slice(0, 10)).eq("a_venir", false).limit(MAX);

  const taches = [
    ...(debats || []).map((d: any) => ({ table: "candidate_debates", cle: { source_key: d.source_key, candidate_id: d.candidate_id }, nom: nomDe.get(d.candidate_id) || "", titre: d.title, url: d.url || `https://www.youtube.com/watch?v=${d.video_id}` })),
    ...(videos || []).map((v: any) => ({ table: "candidate_videos", cle: { video_id: v.video_id, candidate_id: v.candidate_id }, nom: nomDe.get(v.candidate_id) || "", titre: v.title, url: v.url })),
  ].slice(0, MAX);

  let faits = 0, vides = 0, echecs = 0;
  for (const t of taches) {
    let { duree, texte } = dureeEtSousTitres(t.url);
    // Moins d'une minute : clip, rien à résumer.
    if (duree && duree < 60) { await marquer(t, ""); vides++; continue; }
    if (texte.length < 600) texte = await transcrireGemini(t.url);
    if (texte.length < 600) { echecs++; continue; }   // retenté au prochain passage
    const r = await resumer(t.nom, t.titre, texte);
    if (r === null) { echecs++; continue; }
    if (r && !chiffresPresents(r, texte)) { console.log(`  · rejeté (chiffre absent de la transcription) : ${t.titre.slice(0, 60)}`); echecs++; continue; }
    await marquer(t, r);
    r ? faits++ : vides++;
    console.log(`  ✓ ${t.nom} — ${t.titre.slice(0, 70)}${r ? "" : " (rien de substantiel)"}`);
  }
  console.log(`[Vidéos] ${faits} résumé(s), ${vides} sans contenu substantiel, ${echecs} à retenter.`);
}

async function marquer(t: any, resume: string) {
  let q: any = supabase.from(t.table).update({ resume_ia: resume || null, resume_le: new Date().toISOString() });
  for (const [k, v] of Object.entries(t.cle)) q = q.eq(k, v);
  await q;
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
