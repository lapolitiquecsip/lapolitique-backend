import { supabase } from '../../config/supabase.js';
import * as dotenv from 'dotenv';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logStart, logSuccess, logError } from '../../lib/monitoring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Legislature parametrable : la 17 (2024+) par defaut, la 16 (2022-2024) pour le backfill.
// Sans la 16, la base ne couvre pas la periode ou le programme 2022 s'est applique.
const LEGISLATURE = process.env.AN_LEGISLATURE || '17';
const SCRUTINS_ZIP_URL = `https://data.assemblee-nationale.fr/static/openData/repository/${LEGISLATURE}/loi/scrutins/Scrutins.json.zip`;
const TEMP_ZIP_PATH = path.join(process.cwd(), 'scrutins_temp.zip');

export async function fetchAndParseVotes() {
  const hcId = process.env.HEALTHCHECK_ID_VOTES;
  await logStart('fetchAndParseVotes', hcId);

  try {
    console.log(`> Downloading archive to disk using curl...`);
    const { execSync } = await import('child_process');
    const curlCmd = process.platform === 'win32' ? 'curl.exe' : 'curl';
    execSync(`${curlCmd} -L -o "${TEMP_ZIP_PATH}" "${SCRUTINS_ZIP_URL}"`, { stdio: 'inherit' });
    console.log(`> Archive downloaded to disk successfully.`);

    const zip = new AdmZip(TEMP_ZIP_PATH);
    const allEntries = zip.getEntries();
    const jsonEntries = allEntries.filter(e => e.entryName.endsWith('.json'));
    // Fetch existing scrutin IDs to prevent duplicate processing and catch up with old missing scrutins
    console.log(`> Fetching existing scrutin IDs from database...`);
    const existingIds = new Set<string>();
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    while (hasMore) {
      const { data: pageData, error: sFetchError } = await supabase
        .from('scrutins')
        .select('id')
        .range(page * pageSize, (page + 1) * pageSize - 1);
      if (sFetchError) throw new Error(`Could not fetch existing scrutins: ${sFetchError.message}`);
      
      pageData.forEach(s => existingIds.add(s.id.trim().toUpperCase()));
      hasMore = pageData.length === pageSize;
      page++;
    }
    console.log(`> Found ${existingIds.size} existing scrutins in database.`);

    const newEntries = jsonEntries.filter(entry => {
      const match = entry.entryName.match(/(VT[A-Z0-9]+)\.json$/i);
      const id = match ? match[1].trim().toUpperCase() : path.basename(entry.entryName, '.json').trim().toUpperCase();
      return !existingIds.has(id);
    });
    console.log(`> Found ${newEntries.length} new files to process out of ${jsonEntries.length} total files.`);

    // Sort by scrutin number (descending) to process the newest first
    newEntries.sort((a, b) => {
      const matchA = a.entryName.match(/VT(\d+)/);
      const matchB = b.entryName.match(/VT(\d+)/);
      const numA = matchA ? parseInt(matchA[1]) : 0;
      const numB = matchB ? parseInt(matchB[1]) : 0;
      return numB - numA;
    });

    // Safety limit: process max 200 files per run to avoid DB choke
    const maxPerRun = parseInt(process.env.AN_MAX_PER_RUN || '200', 10);
    const entriesToProcess = newEntries.slice(0, maxPerRun);
    console.log(`> Processing up to ${entriesToProcess.length} new entries for performance.`);

    // Fetch active deputies
    const { data: activeDeputies, error: dError } = await supabase
        .from('deputies')
        .select('an_id');
    
    if (dError) throw new Error(`Could not fetch deputies: ${dError.message}`);
    const activeAnIds = new Set(activeDeputies.map(d => d.an_id.trim().toUpperCase()));

    let scrutinsCount = 0;

    for (const entry of entriesToProcess) {
      const content = JSON.parse(entry.getData().toString('utf8'));
      const s = content.scrutin;
      
      // Filtre de millesime. Etait fige sur '2026', ce qui expliquait que la base ne
      // contienne aucun scrutin anterieur : tout l'historique etait silencieusement jete.
      // AN_MIN_DATE permet le backfill (ex. 2022-05-14 pour couvrir le mandat 2022).
      const minDate = process.env.AN_MIN_DATE || '2026-01-01';
      if (!s.dateScrutin || s.dateScrutin < minDate) {
        continue;
      }

      const titreOrig = (s.titre || s.objet.libelle || "");
      const titre = titreOrig.toLowerCase();
      let type = "AUTRE";
      
      if (titre.includes("amendement")) {
        type = "AMENDEMENT";
      } else if (titre.includes("motion de rejet") || titre.includes("motion de censure")) {
        type = "MOTION";
      } else if (
        titre.startsWith("l'ensemble du") || 
        titre.startsWith("l'ensemble de la") ||
        titre.includes("vote sur l'ensemble") ||
        titre.includes("adoption du projet de loi") ||
        titre.includes("adoption de la proposition de loi")
      ) {
        type = "LOI";
      } else if (titre.startsWith("l'article")) {
        type = "ARTICLE";
      } else if (titre.includes("projet de loi") || titre.includes("proposition de loi")) {
        type = "LOI";
      }

      const themes = [
        { name: "Économie & Budget", keywords: ["finances", "budget", "fiscal", "pib", "impôt", "taxe", "économie", "sociale", "secteur public", "pouvoir d'achat"] },
        { name: "Sécurité & Justice", keywords: ["sécurité", "police", "gendarmerie", "terrorisme", "intérieur", "ordre public", "immigration", "frontières", "justice", "pénal", "tribunal", "magistrat", "prison", "loi", "libertés"] },
        { name: "Santé & Social", keywords: ["santé", "hôpital", "médical", "soins", "sécurité sociale", "retraites", "travail", "chômage", "handicap"] },
        { name: "Environnement & Énergie", keywords: ["climat", "écologie", "environnement", "biodiversité", "énergie", "nucléaire", "eau", "transition", "pollution"] },
        { name: "Éducation & Culture", keywords: ["école", "enseignement", "université", "éducation", "culture", "médias", "sport", "jeunesse"] },
        { name: "International & Défense", keywords: ["affaires étrangères", "international", "europe", "union européenne", "diplomatie", "traité", "défense"] },
        { name: "Agriculture", keywords: ["agriculture", "ferme", "agricole", "pêche", "alimentation", "rural"] }
      ];

      let dossierUrl = null;
      const refLeg = s.objet.referenceLegislative;
      if (refLeg) {
        dossierUrl = `https://www.assemblee-nationale.fr/dyn/17/dossiers_legislatifs/${refLeg}`;
      }

      const synth = s.syntheseVote?.decompte;
      const pour = parseInt(synth?.pour || "0");
      const contre = parseInt(synth?.contre || "0");
      const abstention = parseInt(synth?.abstentions || "0");
      const nonVotant = parseInt(synth?.nonVotants || "0");

      let category = "Autre";
      for (const t of themes) {
        if (t.keywords.some(k => titre.includes(k))) {
          category = t.name;
          break;
        }
      }


      const groupResults: any[] = [];
      const ventilationGroups = s.ventilationVotes?.organe?.groupes?.groupe;
      if (ventilationGroups) {
        const gList = Array.isArray(ventilationGroups) ? ventilationGroups : [ventilationGroups];
        gList.forEach((g: any) => {
          const GROUP_NAMES: Record<string, string> = {
            'PO845401': 'LFI-NFP',
            'PO845407': 'GDR (Gauche)',
            'PO845413': 'Socialistes',
            'PO845419': 'Écologistes',
            'PO845425': 'LIOT',
            'PO845439': 'Ensemble (Renaissance)',
            'PO845454': 'MoDem',
            'PO845470': 'Horizons',
            'PO845485': 'Droite Républicaine',
            'PO845514': 'RN',
            'PO872880': 'UDR (Ciotti)',
            'PO840056': 'Non-inscrits'
          };
          groupResults.push({
            group_id: g.organeRef,
            group_label: GROUP_NAMES[g.organeRef] || g.organeRef,
            pour: parseInt(g.vote?.decompteVoix?.pour || "0"),
            contre: parseInt(g.vote?.decompteVoix?.contre || "0"),
            abstention: parseInt(g.vote?.decompteVoix?.abstentions || "0"),
            total: parseInt(g.nombreMembresGroupe || "0")
          });
        });
      }

      const libelleLower = (s.sort?.libelle || "").toLowerCase();
      const isAdopted = libelleLower.includes('adopté') && !libelleLower.includes("n'a pas adopté") && !libelleLower.includes("pas adopté");
      
      const voteDate = new Date(s.dateScrutin);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - voteDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const statusDetail = isAdopted ? (diffDays > 90 ? "En application" : "Adopté") : "Rejeté";
      const impactDetail = isAdopted ? `Impacte le secteur ${category}` : "Aucun impact (texte rejeté)";
      
      let entryDateDetail = "N/A";
      if (isAdopted) {
        const entryDate = new Date(s.dateScrutin);
        entryDate.setMonth(entryDate.getMonth() + 3);
        entryDateDetail = entryDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      }

      let cleanedObjet = s.objet.libelle;
      
      // Clean up common long prefixes
      const prefixesToRemove = [
        "l'ensemble de la proposition de loi",
        "l'ensemble du projet de loi",
        "la proposition de loi",
        "le projet de loi"
      ];
      
      let lowerObjet = cleanedObjet.toLowerCase();
      for (const prefix of prefixesToRemove) {
        if (lowerObjet.startsWith(prefix)) {
          cleanedObjet = cleanedObjet.substring(prefix.length).trim();
          // Capitalize first letter
          cleanedObjet = cleanedObjet.charAt(0).toUpperCase() + cleanedObjet.slice(1);
          break; // Stop after first match
        }
      }

      const scrutinData = {
        id: s.uid,
        numero: parseInt(s.numero),
        date_scrutin: s.dateScrutin,
        objet: cleanedObjet,
        type: type,
        category: category,
        resultat: s.sort.libelle,
        institution: 'AN',
        dossier_url: dossierUrl,
        pour: pour,
        contre: contre,
        abstention: abstention,
        non_votant: nonVotant,
        title: titreOrig,
        group_results: groupResults,
        status_detail: statusDetail,
        impact_detail: impactDetail,
        entry_date_detail: entryDateDetail
      };

      const { error: sError } = await supabase.from('scrutins').upsert(scrutinData, { onConflict: 'id' });
      if (sError) {
        console.error(`  [ERROR] Scrutin ${s.uid}:`, sError.message);
        continue;
      }
      scrutinsCount++;

      // --- RESTORED: INDIVIDUAL VOTES EXTRACTION ---
      const votes: any[] = [];
      
      if (ventilationGroups) {
        const processNominatif = (nominatif: any) => {
          if (!nominatif) return;
          
          const categories = [
            { key: 'pours', subKey: 'votant', pos: 'POUR' },
            { key: 'contres', subKey: 'votant', pos: 'CONTRE' },
            { key: 'abstentions', subKey: 'votant', pos: 'ABSTENTION' },
            { key: 'nonVotants', subKey: 'votant', pos: 'NON_VOTANT' }
          ];

          categories.forEach(({ key, subKey, pos }) => {
            const catObj = nominatif[key];
            if (!catObj || !catObj[subKey]) return;
            const list = Array.isArray(catObj[subKey]) ? catObj[subKey] : [catObj[subKey]];
            list.forEach((d: any) => {
              if (d.acteurRef) {
                const actorId = d.acteurRef.trim().toUpperCase();
                if (activeAnIds.has(actorId)) {
                  votes.push({
                    deputy_an_id: actorId,
                    scrutin_id: s.uid,
                    position: pos,
                    date_scrutin: s.dateScrutin
                  });
                }
              }
            });
          });
        };

        const groupsList = Array.isArray(ventilationGroups) ? ventilationGroups : [ventilationGroups];
        groupsList.forEach((g: any) => {
          processNominatif(g.vote?.decompteNominatif);
        });
      }

      if (votes.length > 0) {
        for (let i = 0; i < votes.length; i += 1000) {
          const batch = votes.slice(i, i + 1000);
          const { error: vError } = await supabase
            .from('deputy_votes')
            .upsert(batch, { onConflict: 'deputy_an_id, scrutin_id' });
          
          if (vError) {
            console.error(`  [ERROR] Votes batch for ${s.uid}:`, vError.message);
          }
        }
        console.log(`  [OK] ${s.uid}: Sync'd ${votes.length} individual votes.`);
      }

      if (scrutinsCount % 100 === 0) console.log(`  - Total Scrutins Processed: ${scrutinsCount}...`);
    }

    console.log(`\n--- SYNCHRONIZATION COMPLETE ---`);
    console.log(`> Scrutins updated: ${scrutinsCount}`);
    
    // Log success
    await logSuccess('fetchAndParseVotes', scrutinsCount, hcId);

    if (fs.existsSync(TEMP_ZIP_PATH)) fs.unlinkSync(TEMP_ZIP_PATH);
    return scrutinsCount;

  } catch (err: any) {
    console.error(`\n[FATAL ERROR]`, err);
    
    // Log failure
    await logError('fetchAndParseVotes', err, hcId);
    throw err;
  }
}

// Standalone execution support
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fetchAndParseVotes();
}


