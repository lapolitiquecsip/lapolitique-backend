import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const DEPARTMENTS: Record<string, string> = {
  "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes",
  "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes", "09": "Ariège", "10": "Aube",
  "11": "Aude", "12": "Aveyron", "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal",
  "16": "Charente", "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "21": "Côte-d'Or",
  "22": "Côtes-d'Armor", "23": "Creuse", "24": "Dordogne", "25": "Doubs", "26": "Drôme",
  "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère", "2A": "Corse-du-Sud", "2B": "Haute-Corse",
  "30": "Gard", "31": "Haute-Garonne", "32": "Gers", "33": "Gironde", "34": "Hérault",
  "35": "Ille-et-Vilaine", "36": "Indre", "37": "Indre-et-Loire", "38": "Isère", "39": "Jura",
  "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire", "44": "Loire-Atlantique",
  "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne", "48": "Lozère", "49": "Maine-et-Loire",
  "50": "Manche", "51": "Marne", "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle",
  "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord", "60": "Oise",
  "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques",
  "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin", "68": "Haut-Rhin",
  "69": "Rhône", "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe", "73": "Savoie",
  "74": "Haute-Savoie", "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne",
  "78": "Yvelines", "79": "Deux-Sèvres", "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne",
  "83": "Var", "84": "Vaucluse", "85": "Vendée", "86": "Vienne", "87": "Haute-Vienne",
  "88": "Vosges", "89": "Yonne", "90": "Territoire de Belfort", "91": "Essonne", "92": "Hauts-de-Seine",
  "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise", "971": "Guadeloupe",
  "972": "Martinique", "973": "Guyane", "974": "La Réunion", "976": "Mayotte", "975": "Saint-Pierre-et-Miquelon",
  "977": "Saint-Barthélemy", "978": "Saint-Martin", "987": "Polynésie française", "988": "Nouvelle-Calédonie",
  "999": "Français de l'étranger"
};

// Map des codes Organes vers Sigles (XVIIème Législature - Vérifié)
const GR_MAP: Record<string, string> = {
  "PO845413": "LFI-NFP",
  "PO845407": "EPR",
  "PO845401": "RN",
  "PO845419": "SOC",
  "PO845425": "DR",
  "PO845439": "EcoS",
  "PO845454": "Dem",
  "PO845470": "HOR",
  "PO845485": "LIOT",
  "PO845514": "GDR",
  "PO872880": "UDR",
  "PO840056": "NI"
};

const PARTY_COLORS: Record<string, string> = {
  "RN": "#153063",
  "LFI-NFP": "#cc241d",
  "EPR": "#ff7900",
  "SOC": "#e1001a",
  "EcoS": "#00a84d",
  "DR": "#0050a4",
  "Dem": "#ee7e37",
  "HOR": "#00a2e8",
  "LIOT": "#9b9b9b",
  "GDR": "#dd0000",
  "UDR": "#2c3e50"
};

// Liste des députés actuellement Ministres (Gouvernement Barnier)
const MINISTERS: Record<string, string> = {
  "Agnès Pannier-Runacher": "Ministre de la Transition écologique, de l'Énergie, du Climat et de la Prévention des risques",
  "Sébastien Lecornu": "Ministre des Armées",
  "Rachida Dati": "Ministre de la Culture",
  "Guillaume Kasbarian": "Ministre de la Fonction publique, de la Simplification et de la Transformation de l'action publique",
  "Anne Genetet": "Ministre de l'Éducation nationale",
  "Jean-Noël Barrot": "Ministre de l'Europe et des Affaires étrangères",
  "Antoine Armand": "Ministre de l'Économie, des Finances et de l'Industrie",
  "Astrid Panosyan-Bouvet": "Ministre du Travail et de l'Emploi",
  "Annie Genevard": "Ministre de l'Agriculture, de la Souveraineté alimentaire et de la Forêt",
  "Geneviève Darrieussecq": "Ministre de la Santé et de l'Accès aux soins"
};

function generateSlug(firstName: string, lastName: string): string {
  return `${firstName}-${lastName}`.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "-").replace(/-+/g, "-");
}

async function importFromAN() {
  const dir = './dep_17_data/json/acteur';
  const files = fs.readdirSync(dir);
  const deputies = new Map<string, any>();

  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const data = JSON.parse(raw);
    const act = data.acteur;
    
    // Check if currently a deputy in 17th
    const mandats = Array.isArray(act.mandats.mandat) ? act.mandats.mandat : [act.mandats.mandat];
    const mandatParlementaire = mandats.find((m: any) => m.typeOrgane === 'ASSEMBLEE' && m.legislature === '17' && m.mandature.causeFin === null);
    
    if (mandatParlementaire) {
      const gpMandat = mandats.find((m: any) => m.typeOrgane === 'GP' && m.legislature === '17' && m.dateFin === null);
      const partyCode = gpMandat?.organes?.organeRef;
      const party = GR_MAP[partyCode] || "NI";
      
      const fullName = `${act.etatCivil.ident.prenom} ${act.etatCivil.ident.nom}`;
      const ministerRole = MINISTERS[fullName];
      const slug = generateSlug(act.etatCivil.ident.prenom, act.etatCivil.ident.nom);
      
      const deptNum = mandatParlementaire.election.lieu.numDepartement;
      const deptName = DEPARTMENTS[deptNum] || deptNum;

      // Base biography
      let biography = `${fullName} est député de la ${mandatParlementaire.election.lieu.numCirco}ème circonscription du département de ${deptName}.`;
      if (ministerRole) {
        biography = `**${ministerRole}**. ${biography}`;
      }

      const deputyData = {
        first_name: act.etatCivil.ident.prenom,
        last_name: act.etatCivil.ident.nom,
        party: party,
        party_color: PARTY_COLORS[party] || "#95A5A6",
        department: deptName,
        constituency_number: parseInt(mandatParlementaire.election.lieu.numCirco),
        an_id: act.uid['#text'],
        slug: slug,
        photo_url: `https://www.nosdeputes.fr/depute/photo/${slug}/250`,
        biography: biography,
        legal_issues: "Aucune affaire judiciaire connue ou signalée à ce jour."
      };

      // Only add if not already present (some actors have multiple records in some datasets)
      if (!deputies.has(slug)) {
        deputies.set(slug, deputyData);
      }
    }
  }

  const finalDeputies = Array.from(deputies.values());
  console.log(`Prêt à importer ${finalDeputies.length} députés...`);
  
  // Wipe existing data to ensure no duplicates or old mappings remain
  await supabase.from('deputies').delete().neq('slug', '____NONE____');
  console.log("Base de données vidée.");

  const { error } = await supabase.from('deputies').insert(finalDeputies);
  if (error) {
    console.error("Erreur lors de l'import :", error);
  } else {
    console.log("Importation réussie !");
  }
}

importFromAN();
