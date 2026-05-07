import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SCRUTINS_ZIP_URL = 'https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip';
const TEMP_ZIP_PATH = path.join(process.cwd(), 'scrutins_temp.zip');

export async function fetchAndParseVotes() {
  const startTime = new Date();
  console.log('--- START VOTES SYNCHRONIZATION ---');
  
  // Log start of pipeline
  await supabase.from('pipeline_logs').insert({
    pipeline_name: 'fetchAndParseVotes',
    status: 'running',
    run_at: startTime.toISOString()
  });

  try {
    console.log(`> Downloading archive to disk...`);
    const response = await fetch(SCRUTINS_ZIP_URL);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(TEMP_ZIP_PATH, Buffer.from(arrayBuffer));
    console.log(`> Archive saved to disk (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB).`);

    const zip = new AdmZip(TEMP_ZIP_PATH);
    const allEntries = zip.getEntries();
    const jsonEntries = allEntries.filter(e => e.entryName.endsWith('.json'));
    console.log(`> Found ${jsonEntries.length} files to process.`);
    
    // Safety limit: process max 200 files per run to avoid DB choke
    const entriesToProcess = jsonEntries.slice(0, 200);
    console.log(`> Processing only the first ${entriesToProcess.length} entries for performance.`);

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
      
      // Skip very old scrutins to speed up sync (only 2026 onwards)
      if (!s.dateScrutin || !s.dateScrutin.startsWith('2026')) {
        continue;
      }

      const titreOrig = (s.titre || s.objet.libelle || "");
      const titre = titreOrig.toLowerCase();
      let type = "AUTRE";
      
      if (titre.includes("amendement")) {
        type = "AMENDEMENT";
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
      const groups = s.ventilationVotes?.organe?.groupes?.groupe;
      if (groups) {
        const groupsList = Array.isArray(groups) ? groups : [groups];
        groupsList.forEach((g: any) => {
          groupResults.push({
            group_id: g.organeRef,
            pour: parseInt(g.vote?.decompteVoix?.pour || "0"),
            contre: parseInt(g.vote?.decompteVoix?.contre || "0"),
            abstention: parseInt(g.vote?.decompteVoix?.abstentions || "0"),
            total: parseInt(g.nombreMembresGroupe || "0")
          });
        });
      }

      const isAdopted = s.sort.libelle.includes('adopté');
      const statusDetail = isAdopted ? "En application" : "Rejeté";
      const impactDetail = isAdopted ? `Impacte le secteur ${category}` : "Aucun impact (texte rejeté)";
      
      let entryDateDetail = "N/A";
      if (isAdopted) {
        const voteDate = new Date(s.dateScrutin);
        voteDate.setMonth(voteDate.getMonth() + 3);
        entryDateDetail = voteDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      }

      const cleanedObjet = s.objet.libelle;


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
      
      if (groups) {
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

        const groupsList = Array.isArray(groups) ? groups : [groups];
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
    await supabase.from('pipeline_logs').insert({
      pipeline_name: 'fetchAndParseVotes',
      status: 'success',
      items_processed: scrutinsCount,
      run_at: startTime.toISOString()
    });

    if (fs.existsSync(TEMP_ZIP_PATH)) fs.unlinkSync(TEMP_ZIP_PATH);

  } catch (err: any) {
    console.error(`\n[FATAL ERROR]`, err);
    
    // Log failure
    await supabase.from('pipeline_logs').insert({
      pipeline_name: 'fetchAndParseVotes',
      status: 'error',
      error_details: err.message,
      run_at: startTime.toISOString()
    });

    throw err;
  }
}

// Standalone execution support
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fetchAndParseVotes();
}


