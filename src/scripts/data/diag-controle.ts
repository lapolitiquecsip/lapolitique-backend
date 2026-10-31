import "dotenv/config";
import { supabase } from "../../config/supabase.js";
import { chercherPresse, jsonDuModele, lireArticle, mediaReconnu, presseBing, verifierControverse } from "../../lib/verification-article.js";

// Diagnostic ponctuel sur GitHub : résultats lisibles par les annotations.
const dire = (m: string) => console.log(`::warning::${m.replace(/\s+/g, " ").slice(0, 300)}`);
const b = await presseBing('"Rima Hassan" menaces');
dire(`Bing : ${b === null ? "null" : b.length} résultats ; reconnus ${(b ?? []).filter(x => mediaReconnu(x.link)).length}`);
const r = await fetch(`https://www.bing.com/news/search?q=${encodeURIComponent('"Rima Hassan"')}&format=rss&setlang=fr-FR&cc=FR`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; LaPolitiqueBot/1.0)" } });
const t = await r.text();
dire(`Bing brut : HTTP ${r.status}, ${t.length} octets, items ${(t.match(/<item>/g) || []).length}, début ${t.slice(0, 80)}`);
const c = await chercherPresse('"Rima Hassan" menaces').catch(e => { dire(`chercherPresse : ${e.message}`); return null; });
dire(`Recherche secours : ${c?.length ?? "null"} ; reconnus ${(c ?? []).filter(x => mediaReconnu(x.link)).length}`);
const lien = (c ?? []).find(x => mediaReconnu(x.link))?.link;
if (lien) { const a = await lireArticle(lien); dire(`Lecture ${lien.slice(8, 40)} : via ${a?.via}, ${a?.texte.length} caractères, date ${a?.date}`); }
const j = await jsonDuModele('Réponds en JSON strict : { "articles": [{ "article": 0, "confirme": true, "phrase": 1 }] }', "Test : renvoie cet exemple.").catch(e => { dire(`Modèle : ${e.message}`); return null; });
dire(`Modèle : ${JSON.stringify(j)}`);
const { data } = await supabase.from("controverses_veille").select("personne, texte, remplace, sources").eq("id", 82);
const e = data?.[0];
if (e) { const v = await verifierControverse(e.personne, e.texte, { developpement: !!e.remplace, titres: (e.sources || []).map((x: any) => x?.titre).filter(Boolean) }).catch(x => ({ ok: false, motif: `ERR ${x.message}` })); dire(`Vérif #82 : ${JSON.stringify(v).slice(0, 260)}`); }
process.exit(0);
