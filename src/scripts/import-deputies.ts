
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

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

const PARTY_COLORS: Record<string, string> = {
  "RN": "#153063",
  "LFI-NFP": "#cc241d",
  "LFI": "#cc241d",
  "EPR": "#ff7900",
  "RE": "#ff7900",
  "REN": "#ff7900",
  "SOC": "#e1001a",
  "PS": "#e1001a",
  "ECO": "#00a84d",
  "EELV": "#00a84d",
  "LR": "#0050a4",
  "DR": "#0050a4", // Droite Républicaine (ex-LR)
  "MODEM": "#ee7e37",
  "DEM": "#ee7e37",
  "HOR": "#00a2e8",
  "LIOT": "#9b9b9b",
  "GDR": "#dd0000",
  "NI": "#666666",
  "UDR": "#3498DB",
  "AD-RN": "#153063" // Alliance de Ciotti
};

async function importDeputies() {
  console.log('🚀 Starting Deputies Mega-Import (XVIIe Legislature)...');

  try {
    console.log('📥 Fetching from nosdeputes.fr...');
    const response = await fetch('https://www.nosdeputes.fr/deputes/json');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    
    // Filter for deputies in office (mandat_fin is null)
    const rawDeputies = data.deputes.filter((item: any) => item.depute.mandat_fin === null);

    console.log(`✅ Fetched ${rawDeputies.length} active deputies.`);

    if (rawDeputies.length === 0) {
      throw new Error('No active deputies found. Data might be stale.');
    }

    console.log('🧹 Clearing old entries...');
    const { error: deleteError } = await supabase.from('deputies').delete().neq('last_name', 'IMPOSSIBLE_VALUE');
    if (deleteError) throw new Error(`Delete error: ${deleteError.message}`);

    console.log('🗺️ Mapping data...');
    const mappedDeputies = rawDeputies.map((item: any) => {
      const d = item.depute;
      // Handle department number cases (e.g. 01 vs 1)
      let deptNum = d.num_deptmt;
      if (deptNum && deptNum.length === 1) deptNum = '0' + deptNum;
      
      const deptName = DEPARTMENTS[deptNum] || d.nom_circo || deptNum;
      const slug = d.slug;
      
      return {
        first_name: d.prenom,
        last_name: d.nom_de_famille,
        party: d.groupe_sigle,
        party_color: PARTY_COLORS[d.groupe_sigle] || "#95A5A6",
        department: deptName,
        constituency_number: d.num_circo,
        an_id: d.id_an,
        slug: slug,
        photo_url: `https://www.nosdeputes.fr/depute/photo/${slug}/250`
      };
    });

    console.log('📤 Inserting to Supabase...');
    const { error: insertError } = await supabase.from('deputies').insert(mappedDeputies);
    
    if (insertError) {
      console.error('❌ Insertion Error:', insertError);
      throw insertError;
    }

    console.log(`✨ Successfully imported ${mappedDeputies.length} deputies!`);

  } catch (error) {
    console.error('💥 Critical Error:', error);
  }
}

importDeputies();
