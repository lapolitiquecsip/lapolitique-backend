import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DATA_DIR = path.join(__dirname, '../../dep_17_data/json');

async function main() {
  console.log('--- ENRICHISSEMENT DES BIOGRAPHIES (FOCUS MÉTIER) ---');

  // 1. Charger les organes (Groupes, Commissions)
  const organs: Record<string, any> = {};
  const organDir = path.join(DATA_DIR, 'organe');
  if (fs.existsSync(organDir)) {
    const organFiles = fs.readdirSync(organDir).filter(f => f.endsWith('.json'));
    organFiles.forEach(file => {
      const data = JSON.parse(fs.readFileSync(path.join(organDir, file), 'utf8'));
      organs[data.organe.uid] = data.organe;
    });
    console.log(`> ${Object.keys(organs).length} organes chargés.`);
  }

  // 2. Traiter les acteurs (Députés)
  const actorDir = path.join(DATA_DIR, 'acteur');
  if (!fs.existsSync(actorDir)) {
    console.error('Erreur: Dossier acteur introuvable dans tmp/json');
    return;
  }
  
  const actorFiles = fs.readdirSync(actorDir).filter(f => f.endsWith('.json'));
  console.log(`> ${actorFiles.length} fichiers acteurs trouvés.`);

  let updatedCount = 0;

  for (const file of actorFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(actorDir, file), 'utf8'));
    const actor = data.acteur;
    const anId = actor.uid['#text'];
    
    // Extraire infos de base
    const first_name = actor.etatCivil.ident.prenom;
    const last_name = actor.etatCivil.ident.nom;
    const profession = actor.profession?.libelleCourant || 'Non renseignée';
    const category = actor.profession?.socProcINSEE?.catSocPro || 'Catégorie non spécifiée';
    const birthDate = actor.etatCivil.infoNaissance?.dateNais;
    const birthPlace = actor.etatCivil.infoNaissance?.villeNais;
    
    // Identifier Commission, Groupe, Ancienneté, Diplomatie et Mandats Locaux
    let committee = '';
    let group = '';
    let earliestMandateYear = '';
    let friendshipGroups: string[] = [];
    let pastLocalMandates: string[] = [];
    
    const mandats = actor.mandats.mandat;
    const mandatList = Array.isArray(mandats) ? mandats : [mandats];
    
    mandatList.forEach((m: any) => {
      // 1. Ancienneté Parlementaire
      if (m.typeOrgane === 'ASSEMBLEE' || m.typeOrgane === 'ASSEMBLEE_DEMISSION') {
        const year = m.dateDebut?.split('-')[0];
        if (year && (!earliestMandateYear || parseInt(year) < parseInt(earliestMandateYear))) {
          earliestMandateYear = year;
        }
      }

      // 2. Mandats Locaux (COLTER, MAIRE, etc.)
      const isLocal = m.typeOrgane?.includes('COLTER') || m.typeOrgane?.includes('MAIRE') || m.typeOrgane?.includes('CONSEIL');
      if (isLocal && m.libelleQualite && !pastLocalMandates.includes(m.libelleQualite)) {
          // Ne garder que les mandats significatifs ou différents
          if (!pastLocalMandates.some(prev => m.libelleQualite.includes(prev) || prev.includes(m.libelleQualite))) {
            pastLocalMandates.push(m.libelleQualite);
          }
      }

      // 3. Organes de la législature actuelle (17 ou null)
      if (m.legislature === '17' || m.legislature === null) {
        const organe = organs[m.organes.organeRef];
        if (!organe) return;
        
        if (organe.codeType === 'GP') {
           group = organe.libelle;
        } else if (organe.codeType === 'COMPER') {
           committee = organe.libelle;
        } else if (organe.codeType === 'GA') {
           const countryMatch = organe.libelle.match(/France-([^)]+)/);
           const country = countryMatch ? countryMatch[1].trim() : organe.libelle.replace("Groupe d'amiti\u00e9 France-", "");
           if (country && !friendshipGroups.includes(country)) {
             friendshipGroups.push(country);
           }
        }
      }
    });

    // Générer la biographie HYPER-PERSONNALISÉE (DÉ-BLOCAGE + NEUTRE)
    let bio = `**Profession** : ${profession}\n\n`;
    bio += `**Milieu social d'origine** : ${category}\n\n`;
    
    if (birthDate && birthPlace) {
      const year = birthDate.split('-')[0];
      bio += `**Origine** : Né(e) en ${year} à ${birthPlace}\n\n`;
    }

    if (earliestMandateYear) {
      const isNew = earliestMandateYear === '2024';
      bio += `**Ancienneté** : ${earliestMandateYear} ${isNew ? '(Nouvel élu)' : '(Carrière parlementaire)'}\n\n`;
    }

    if (pastLocalMandates.length > 0) {
      bio += `**Mandats locaux** : ${pastLocalMandates.slice(0, 3).join(', ')}\n\n`;
    }

    if (group) {
      bio += `**Groupe** : ${group}\n\n`;
    }

    if (committee) {
      bio += `**Commission** : ${committee}\n\n`;
    }

    if (friendshipGroups.length > 0) {
      bio += `**Amitiés internationales** : ${friendshipGroups.join(', ')}`;
    }

    // Update DB
    const { error } = await supabase
      .from('deputies')
      .update({ biography: bio })
      .eq('an_id', anId);

    if (error) {
      // console.error(`Erreur pour ${anId}:`, error.message);
    } else {
      updatedCount++;
      if (updatedCount % 50 === 0) {
        console.log(`> ${updatedCount} biographies générées...`);
      }
    }
  }

  console.log(`\nTERMINE : ${updatedCount} biographies ont été générées et injectées dans la base de données.`);
}

main().catch(console.error);
