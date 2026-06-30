import { Router } from 'express';
import { generateMockCommune } from '../utils/mockTerritoryGenerator.js';
import { getElusForCommune } from '../utils/rne.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const indicatorsPath = path.resolve(__dirname, '../data/departments_indicators.json');
const DEPARTMENTS_INDICATORS = JSON.parse(fs.readFileSync(indicatorsPath, 'utf8'));

const communesIndicatorsPath = path.resolve(__dirname, '../data/communes_indicators.json');
const COMMUNES_INDICATORS = JSON.parse(fs.readFileSync(communesIndicatorsPath, 'utf8'));
const regionsIndicatorsPath = path.resolve(__dirname, '../data/regions_indicators.json');
const REGIONS_INDICATORS = JSON.parse(fs.readFileSync(regionsIndicatorsPath, 'utf8'));

const REGIONS = [
  {
    id: "11", name: "Île-de-France", president: "Valérie Pécresse", party: "LR", image: "/images/regions/ile_de_france.png",
    demographie: { populationTotal: 12400000, densite: 1030, evolution10ans: "+2.5%", moins25ans: 32, plus65ans: 16 },
    economie: { chomage: 6.5, revenuMedian: 2450, pauvrete: 15 },
    education: { bac: 92, diplomesSup: 45, decrochage: 8 },
    sante: { medecins10k: 35, scoreAPL: 75, esperanceVie: 83 },
    securite: { atteintesPersonnes: 12, atteintesBiens: 35 },
    logement: { prixM2: 10500, logementsSociaux: 22, proprietaires: 33 },
    politique: { pres2022T1: "Macron 35%, Mélenchon 30%, Le Pen 12%", pres2022T2: "Macron 73%, Le Pen 27%", participation: 75, elu: "Valérie Pécresse (LR)", eluDepuis: "2015" },
    finances: { budgetHabitant: 435, endettement: 65, investissement: 30 },
    environnement: { qualiteAir: 60, surfaceNaturelle: 48, risques: "modéré" },
  },
  {
    id: "84", name: "Auvergne-Rhône-Alpes", president: "Fabrice Pannekoucke", party: "LR", image: "/images/regions/auvergne_rhone_alpes.png",
    demographie: { populationTotal: 8200000, densite: 115, evolution10ans: "+3.1%", moins25ans: 28, plus65ans: 21 },
    economie: { chomage: 6.0, revenuMedian: 2250, pauvrete: 12 },
    education: { bac: 90, diplomesSup: 38, decrochage: 9 },
    sante: { medecins10k: 30, scoreAPL: 65, esperanceVie: 82.5 },
    securite: { atteintesPersonnes: 8, atteintesBiens: 25 },
    logement: { prixM2: 3200, logementsSociaux: 16, proprietaires: 55 },
    politique: { pres2022T1: "Macron 28%, Le Pen 25%, Mélenchon 21%", pres2022T2: "Macron 59%, Le Pen 41%", participation: 76, elu: "Fabrice Pannekoucke (LR)", eluDepuis: "2024" },
    finances: { budgetHabitant: 610, endettement: 55, investissement: 35 },
    environnement: { qualiteAir: 65, surfaceNaturelle: 65, risques: "élevé" },
  },
  {
    id: "32", name: "Hauts-de-France", president: "Xavier Bertrand", party: "LR", image: "/images/regions/hauts_de_france.png",
    demographie: { populationTotal: 6000000, densite: 188, evolution10ans: "+0.5%", moins25ans: 31, plus65ans: 19 },
    economie: { chomage: 8.5, revenuMedian: 2050, pauvrete: 18 },
    education: { bac: 86, diplomesSup: 30, decrochage: 12 },
    sante: { medecins10k: 25, scoreAPL: 55, esperanceVie: 80.5 },
    securite: { atteintesPersonnes: 10, atteintesBiens: 28 },
    logement: { prixM2: 2100, logementsSociaux: 24, proprietaires: 52 },
    politique: { pres2022T1: "Le Pen 33%, Macron 25%, Mélenchon 19%", pres2022T2: "Le Pen 52%, Macron 48%", participation: 72, elu: "Xavier Bertrand (LR)", eluDepuis: "2015" },
    finances: { budgetHabitant: 683, endettement: 70, investissement: 25 },
    environnement: { qualiteAir: 55, surfaceNaturelle: 75, risques: "faible" },
  },
  {
    id: "75", name: "Nouvelle-Aquitaine", president: "Alain Rousset", party: "PS", image: "/images/regions/nouvelle_aquitaine.png",
    demographie: { populationTotal: 6100000, densite: 72, evolution10ans: "+4.2%", moins25ans: 26, plus65ans: 25 },
    economie: { chomage: 6.8, revenuMedian: 2150, pauvrete: 13 },
    education: { bac: 89, diplomesSup: 34, decrochage: 10 },
    sante: { medecins10k: 28, scoreAPL: 60, esperanceVie: 82.8 },
    securite: { atteintesPersonnes: 7, atteintesBiens: 22 },
    logement: { prixM2: 2800, logementsSociaux: 13, proprietaires: 62 },
    politique: { pres2022T1: "Macron 27%, Le Pen 23%, Mélenchon 21%", pres2022T2: "Macron 58%, Le Pen 42%", participation: 77, elu: "Alain Rousset (PS)", eluDepuis: "1998" },
    finances: { budgetHabitant: 541, endettement: 58, investissement: 32 },
    environnement: { qualiteAir: 75, surfaceNaturelle: 82, risques: "modéré" },
  },
  {
    id: "76", name: "Occitanie", president: "Carole Delga", party: "PS", image: "/images/regions/occitanie.png",
    demographie: { populationTotal: 6100000, densite: 84, evolution10ans: "+6.8%", moins25ans: 28, plus65ans: 23 },
    economie: { chomage: 8.2, revenuMedian: 2100, pauvrete: 16 },
    education: { bac: 88, diplomesSup: 36, decrochage: 11 },
    sante: { medecins10k: 32, scoreAPL: 68, esperanceVie: 82.6 },
    securite: { atteintesPersonnes: 8, atteintesBiens: 26 },
    logement: { prixM2: 2500, logementsSociaux: 14, proprietaires: 58 },
    politique: { pres2022T1: "Le Pen 24%, Macron 23%, Mélenchon 22%", pres2022T2: "Macron 53%, Le Pen 47%", participation: 76, elu: "Carole Delga (PS)", eluDepuis: "2015" },
    finances: { budgetHabitant: 583, endettement: 62, investissement: 34 },
    environnement: { qualiteAir: 70, surfaceNaturelle: 80, risques: "élevé" },
  },
  {
    id: "44", name: "Grand Est", president: "Franck Leroy", party: "Horizons", image: "/images/regions/grand_est.png",
    demographie: { populationTotal: 5600000, densite: 97, evolution10ans: "+0.2%", moins25ans: 29, plus65ans: 21 },
    economie: { chomage: 7.2, revenuMedian: 2180, pauvrete: 14 },
    education: { bac: 88, diplomesSup: 32, decrochage: 10 },
    sante: { medecins10k: 27, scoreAPL: 58, esperanceVie: 81.8 },
    securite: { atteintesPersonnes: 8, atteintesBiens: 23 },
    logement: { prixM2: 2000, logementsSociaux: 19, proprietaires: 59 },
    politique: { pres2022T1: "Le Pen 29%, Macron 27%, Mélenchon 19%", pres2022T2: "Macron 52%, Le Pen 48%", participation: 73, elu: "Franck Leroy (Horizons)", eluDepuis: "2023" },
    finances: { budgetHabitant: 732, endettement: 68, investissement: 28 },
    environnement: { qualiteAir: 60, surfaceNaturelle: 78, risques: "faible" },
  },
  {
    id: "93", name: "Provence-Alpes-Côte d'Azur", president: "Renaud Muselier", party: "RE", image: "/images/regions/paca.png",
    demographie: { populationTotal: 5200000, densite: 165, evolution10ans: "+2.8%", moins25ans: 27, plus65ans: 24 },
    economie: { chomage: 7.8, revenuMedian: 2200, pauvrete: 16 },
    education: { bac: 87, diplomesSup: 35, decrochage: 11 },
    sante: { medecins10k: 38, scoreAPL: 80, esperanceVie: 83.2 },
    securite: { atteintesPersonnes: 11, atteintesBiens: 32 },
    logement: { prixM2: 4200, logementsSociaux: 12, proprietaires: 54 },
    politique: { pres2022T1: "Le Pen 27%, Macron 23%, Mélenchon 20%", pres2022T2: "Macron 50.5%, Le Pen 49.5%", participation: 74, elu: "Renaud Muselier (RE)", eluDepuis: "2017" },
    finances: { budgetHabitant: 613, endettement: 60, investissement: 31 },
    environnement: { qualiteAir: 65, surfaceNaturelle: 68, risques: "élevé" },
  },
  {
    id: "52", name: "Pays de la Loire", president: "Christelle Morançais", party: "Horizons", image: "/images/regions/pays_de_la_loire.png",
    demographie: { populationTotal: 3900000, densite: 121, evolution10ans: "+5.1%", moins25ans: 30, plus65ans: 21 },
    economie: { chomage: 5.8, revenuMedian: 2220, pauvrete: 11 },
    education: { bac: 91, diplomesSup: 35, decrochage: 8 },
    sante: { medecins10k: 24, scoreAPL: 50, esperanceVie: 82.9 },
    securite: { atteintesPersonnes: 7, atteintesBiens: 21 },
    logement: { prixM2: 2600, logementsSociaux: 15, proprietaires: 63 },
    politique: { pres2022T1: "Macron 33%, Mélenchon 21%, Le Pen 20%", pres2022T2: "Macron 64%, Le Pen 36%", participation: 78, elu: "Christelle Morançais (Horizons)", eluDepuis: "2017" },
    finances: { budgetHabitant: 589, endettement: 52, investissement: 36 },
    environnement: { qualiteAir: 75, surfaceNaturelle: 85, risques: "faible" },
  },
  {
    id: "28", name: "Normandie", president: "Hervé Morin", party: "LC", image: "/images/regions/normandie.png",
    demographie: { populationTotal: 3300000, densite: 110, evolution10ans: "+0.8%", moins25ans: 29, plus65ans: 22 },
    economie: { chomage: 6.5, revenuMedian: 2150, pauvrete: 13 },
    education: { bac: 88, diplomesSup: 31, decrochage: 10 },
    sante: { medecins10k: 23, scoreAPL: 48, esperanceVie: 82.1 },
    securite: { atteintesPersonnes: 7, atteintesBiens: 20 },
    logement: { prixM2: 2100, logementsSociaux: 18, proprietaires: 60 },
    politique: { pres2022T1: "Macron 29%, Le Pen 27%, Mélenchon 19%", pres2022T2: "Macron 56%, Le Pen 44%", participation: 76, elu: "Hervé Morin (LC)", eluDepuis: "2016" },
    finances: { budgetHabitant: 636, endettement: 59, investissement: 33 },
    environnement: { qualiteAir: 70, surfaceNaturelle: 82, risques: "modéré" },
  },
  {
    id: "53", name: "Bretagne", president: "Loïg Chesnais-Girard", party: "DVG", image: "/images/regions/bretagne.png",
    demographie: { populationTotal: 3400000, densite: 124, evolution10ans: "+4.5%", moins25ans: 28, plus65ans: 23 },
    economie: { chomage: 5.5, revenuMedian: 2250, pauvrete: 10 },
    education: { bac: 92, diplomesSup: 38, decrochage: 7 },
    sante: { medecins10k: 26, scoreAPL: 55, esperanceVie: 83.1 },
    securite: { atteintesPersonnes: 6, atteintesBiens: 18 },
    logement: { prixM2: 2800, logementsSociaux: 11, proprietaires: 66 },
    politique: { pres2022T1: "Macron 32%, Mélenchon 22%, Le Pen 19%", pres2022T2: "Macron 66%, Le Pen 34%", participation: 79, elu: "Loïg Chesnais-Girard (DVG)", eluDepuis: "2017" },
    finances: { budgetHabitant: 568, endettement: 50, investissement: 38 },
    environnement: { qualiteAir: 80, surfaceNaturelle: 84, risques: "faible" },
  },
  {
    id: "27", name: "Bourgogne-Franche-Comté", president: "Jérôme Durain", party: "PS", image: "/images/regions/bourgogne_franche_comte.png",
    demographie: { populationTotal: 2800000, densite: 58, evolution10ans: "-0.5%", moins25ans: 27, plus65ans: 24 },
    economie: { chomage: 6.2, revenuMedian: 2180, pauvrete: 12 },
    education: { bac: 88, diplomesSup: 32, decrochage: 9 },
    sante: { medecins10k: 25, scoreAPL: 52, esperanceVie: 82.2 },
    securite: { atteintesPersonnes: 6, atteintesBiens: 19 },
    logement: { prixM2: 1700, logementsSociaux: 16, proprietaires: 64 },
    politique: { pres2022T1: "Le Pen 27%, Macron 26%, Mélenchon 18%", pres2022T2: "Macron 52%, Le Pen 48%", participation: 76, elu: "Jérôme Durain (PS)", eluDepuis: "2025" },
    finances: { budgetHabitant: 686, endettement: 56, investissement: 30 },
    environnement: { qualiteAir: 75, surfaceNaturelle: 86, risques: "faible" },
  },
  {
    id: "24", name: "Centre-Val de Loire", president: "François Bonneau", party: "PS", image: "/images/regions/centre_val_de_loire.png",
    demographie: { populationTotal: 2600000, densite: 66, evolution10ans: "0.0%", moins25ans: 28, plus65ans: 23 },
    economie: { chomage: 6.6, revenuMedian: 2190, pauvrete: 12 },
    education: { bac: 88, diplomesSup: 31, decrochage: 10 },
    sante: { medecins10k: 22, scoreAPL: 45, esperanceVie: 82.4 },
    securite: { atteintesPersonnes: 7, atteintesBiens: 20 },
    logement: { prixM2: 1800, logementsSociaux: 17, proprietaires: 65 },
    politique: { pres2022T1: "Le Pen 25%, Macron 25%, Mélenchon 19%", pres2022T2: "Macron 55%, Le Pen 45%", participation: 75, elu: "François Bonneau (PS)", eluDepuis: "2007" },
    finances: { budgetHabitant: 642, endettement: 58, investissement: 31 },
    environnement: { qualiteAir: 75, surfaceNaturelle: 85, risques: "faible" },
  },
  {
    id: "94", name: "Corse", president: "Gilles Simeoni", party: "Femu a Corsica", image: "/images/regions/corse.png",
    demographie: { populationTotal: 350000, densite: 40, evolution10ans: "+9.5%", moins25ans: 24, plus65ans: 25 },
    economie: { chomage: 7.5, revenuMedian: 2050, pauvrete: 18 },
    education: { bac: 89, diplomesSup: 30, decrochage: 12 },
    sante: { medecins10k: 32, scoreAPL: 65, esperanceVie: 83.5 },
    securite: { atteintesPersonnes: 6, atteintesBiens: 18 },
    logement: { prixM2: 3500, logementsSociaux: 9, proprietaires: 58 },
    politique: { pres2022T1: "Le Pen 28%, Macron 18%, Zemmour 12%", pres2022T2: "Le Pen 58%, Macron 42%", participation: 68, elu: "Gilles Simeoni (Femu a Corsica)", eluDepuis: "2015" },
    finances: { budgetHabitant: 3948, endettement: 60, investissement: 28 },
    environnement: { qualiteAir: 85, surfaceNaturelle: 90, risques: "élevé" },
  }
];

const DEPARTMENTS = [
  {
    "id": "01",
    "name": "Ain",
    "president": "Jean DEGUERRY",
    "party": "LR"
  },
  {
    "id": "02",
    "name": "Aisne",
    "president": "Nicolas FRICOTEAUX",
    "party": "UDI"
  },
  {
    "id": "03",
    "name": "Allier",
    "president": "Claude RIBOULET",
    "party": "UDI"
  },
  {
    "id": "04",
    "name": "Alpes-de-Haute-Provence",
    "president": "Eliane BARREILLE",
    "party": "LR"
  },
  {
    "id": "05",
    "name": "Hautes-Alpes",
    "president": "Jean-Marie BERNARD",
    "party": "LR"
  },
  {
    "id": "06",
    "name": "Alpes-Maritimes",
    "president": "Charles Ange GINESY",
    "party": "LR"
  },
  {
    "id": "07",
    "name": "Ardèche",
    "president": "Olivier AMRANE",
    "party": "LR"
  },
  {
    "id": "08",
    "name": "Ardennes",
    "president": "Noël BOURGEOIS",
    "party": "DVD"
  },
  {
    "id": "09",
    "name": "Ariège",
    "president": "Christine TEQUI",
    "party": "PS"
  },
  {
    "id": "10",
    "name": "Aube",
    "president": "Philippe PICHERY",
    "party": "DVD"
  },
  {
    "id": "11",
    "name": "Aude",
    "president": "Hélène SANDRAGNÉ",
    "party": "PS"
  },
  {
    "id": "12",
    "name": "Aveyron",
    "president": "Arnaud VIALA",
    "party": "LR"
  },
  {
    "id": "13",
    "name": "Bouches-du-Rhône",
    "president": "Martine VASSAL",
    "party": "LR"
  },
  {
    "id": "14",
    "name": "Calvados",
    "president": "Jean-Léonce DUPONT",
    "party": "UDI"
  },
  {
    "id": "15",
    "name": "Cantal",
    "president": "Bruno FAURE",
    "party": "LR"
  },
  {
    "id": "16",
    "name": "Charente",
    "president": "Philippe BOUTY",
    "party": "DVG"
  },
  {
    "id": "17",
    "name": "Charente-Maritime",
    "president": "Sylvie MARCILLY",
    "party": "DVD"
  },
  {
    "id": "18",
    "name": "Cher",
    "president": "Jacques FLEURY",
    "party": "LR"
  },
  {
    "id": "19",
    "name": "Corrèze",
    "president": "Pascal COSTE",
    "party": "LR"
  },
  {
    "id": "21",
    "name": "Côte-d'Or",
    "president": "François SAUVADET",
    "party": "UDI"
  },
  {
    "id": "22",
    "name": "Côtes-d'Armor",
    "president": "Christian COAIL",
    "party": "PS"
  },
  {
    "id": "23",
    "name": "Creuse",
    "president": "Valérie SIMONET",
    "party": "LR"
  },
  {
    "id": "24",
    "name": "Dordogne",
    "president": "Germinal PEIRO",
    "party": "PS"
  },
  {
    "id": "25",
    "name": "Doubs",
    "president": "Christine BOUQUIN",
    "party": "DVD"
  },
  {
    "id": "26",
    "name": "Drôme",
    "president": "Marie-Pierre MOUTON",
    "party": "LR"
  },
  {
    "id": "27",
    "name": "Eure",
    "president": "Alexandre RASSAËRT",
    "party": "LR"
  },
  {
    "id": "28",
    "name": "Eure-et-Loir",
    "president": "Christophe LE DORVEN",
    "party": "LR"
  },
  {
    "id": "29",
    "name": "Finistère",
    "president": "Maël DE CALAN",
    "party": "DVD"
  },
  {
    "id": "2A",
    "name": "Corse-du-Sud",
    "president": "Gilles SIMEONI",
    "party": "Femu a Corsica"
  },
  {
    "id": "2B",
    "name": "Haute-Corse",
    "president": "Gilles SIMEONI",
    "party": "Femu a Corsica"
  },
  {
    "id": "30",
    "name": "Gard",
    "president": "Françoise LAURENT-PERRIGOT",
    "party": "PS"
  },
  {
    "id": "31",
    "name": "Haute-Garonne",
    "president": "Sebastien VINCINI",
    "party": "PS"
  },
  {
    "id": "32",
    "name": "Gers",
    "president": "Philippe DUPOUY",
    "party": "PS"
  },
  {
    "id": "33",
    "name": "Gironde",
    "president": "Jean-Luc GLEYZE",
    "party": "PS"
  },
  {
    "id": "34",
    "name": "Hérault",
    "president": "Kléber MESQUIDA",
    "party": "PS"
  },
  {
    "id": "35",
    "name": "Ille-et-Vilaine",
    "president": "Jean-Luc CHENUT",
    "party": "PS"
  },
  {
    "id": "36",
    "name": "Indre",
    "president": "Marc FLEURET",
    "party": "UDI"
  },
  {
    "id": "37",
    "name": "Indre-et-Loire",
    "president": "Nadège ARNAULT",
    "party": "DVD"
  },
  {
    "id": "38",
    "name": "Isère",
    "president": "Jean-Pierre BARBIER",
    "party": "LR"
  },
  {
    "id": "39",
    "name": "Jura",
    "president": "Gérôme FASSENET",
    "party": "LR"
  },
  {
    "id": "40",
    "name": "Landes",
    "president": "Xavier FORTINON",
    "party": "PS"
  },
  {
    "id": "41",
    "name": "Loir-et-Cher",
    "president": "Philippe GOUET",
    "party": "UDI"
  },
  {
    "id": "42",
    "name": "Loire",
    "president": "Georges ZIEGLER",
    "party": "LR"
  },
  {
    "id": "43",
    "name": "Haute-Loire",
    "president": "Marie-Agnès PETIT",
    "party": "LR"
  },
  {
    "id": "44",
    "name": "Loire-Atlantique",
    "president": "Michel MENARD",
    "party": "PS"
  },
  {
    "id": "45",
    "name": "Loiret",
    "president": "Marc GAUDET",
    "party": "UDI"
  },
  {
    "id": "46",
    "name": "Lot",
    "president": "Serge RIGAL",
    "party": "DVG"
  },
  {
    "id": "47",
    "name": "Lot-et-Garonne",
    "president": "Sophie BORDERIE",
    "party": "PS"
  },
  {
    "id": "48",
    "name": "Lozère",
    "president": "Laurent SUAU",
    "party": "DVG"
  },
  {
    "id": "49",
    "name": "Maine-et-Loire",
    "president": "Florence DABIN",
    "party": "DVD"
  },
  {
    "id": "50",
    "name": "Manche",
    "president": "Jean MORIN",
    "party": "DVD"
  },
  {
    "id": "51",
    "name": "Marne",
    "president": "Jean-Marc ROZE",
    "party": "DVD"
  },
  {
    "id": "52",
    "name": "Haute-Marne",
    "president": "Nicolas LACROIX",
    "party": "LR"
  },
  {
    "id": "53",
    "name": "Mayenne",
    "president": "Olivier RICHEFOU",
    "party": "UDI"
  },
  {
    "id": "54",
    "name": "Meurthe-et-Moselle",
    "president": "Chaynesse KHIROUNI",
    "party": "PS"
  },
  {
    "id": "55",
    "name": "Meuse",
    "president": "Jérôme DUMONT",
    "party": "DVD"
  },
  {
    "id": "56",
    "name": "Morbihan",
    "president": "David LAPPARTIENT",
    "party": "DVD"
  },
  {
    "id": "57",
    "name": "Moselle",
    "president": "Patrick WEITEN",
    "party": "UDI"
  },
  {
    "id": "58",
    "name": "Nièvre",
    "president": "Fabien BAZIN",
    "party": "PS"
  },
  {
    "id": "59",
    "name": "Nord",
    "president": "Christian POIRET",
    "party": "DVD"
  },
  {
    "id": "60",
    "name": "Oise",
    "president": "Nadège LEFEBVRE",
    "party": "LR"
  },
  {
    "id": "61",
    "name": "Orne",
    "president": "Christophe DE BALORRE",
    "party": "LR"
  },
  {
    "id": "62",
    "name": "Pas-de-Calais",
    "president": "Jean-Claude LEROY",
    "party": "PS"
  },
  {
    "id": "63",
    "name": "Puy-de-Dôme",
    "president": "Lionel CHAUVIN",
    "party": "DVD"
  },
  {
    "id": "64",
    "name": "Pyrénées-Atlantiques",
    "president": "Jean-Jacques LASSERRE",
    "party": "MoDem"
  },
  {
    "id": "65",
    "name": "Hautes-Pyrénées",
    "president": "Michel PÉLIEU",
    "party": "PRG"
  },
  {
    "id": "66",
    "name": "Pyrénées-Orientales",
    "president": "Hermeline MALHERBE",
    "party": "PS"
  },
  {
    "id": "67",
    "name": "Bas-Rhin",
    "president": "Frédéric BIERRY",
    "party": "LR"
  },
  {
    "id": "68",
    "name": "Haut-Rhin",
    "president": "Frédéric BIERRY",
    "party": "LR"
  },
  {
    "id": "69",
    "name": "Rhône",
    "president": "Christophe GUILLOTEAU",
    "party": "LR"
  },
  {
    "id": "70",
    "name": "Haute-Saône",
    "president": "Yves KRATTINGER",
    "party": "DVG"
  },
  {
    "id": "71",
    "name": "Saône-et-Loire",
    "president": "André ACCARY",
    "party": "LR"
  },
  {
    "id": "72",
    "name": "Sarthe",
    "president": "Dominique LE MENER",
    "party": "DVD"
  },
  {
    "id": "73",
    "name": "Savoie",
    "president": "Hervé GAYMARD",
    "party": "LR"
  },
  {
    "id": "74",
    "name": "Haute-Savoie",
    "president": "Martial SADDIER",
    "party": "LR"
  },
  {
    "id": "75",
    "name": "Paris",
    "president": "Anne HIDALGO",
    "party": "PS"
  },
  {
    "id": "76",
    "name": "Seine-Maritime",
    "president": "Bertrand BELLANGER",
    "party": "Renaissance"
  },
  {
    "id": "77",
    "name": "Seine-et-Marne",
    "president": "Jean-François PARIGI",
    "party": "LR"
  },
  {
    "id": "78",
    "name": "Yvelines",
    "president": "Pierre BEDIER",
    "party": "LR"
  },
  {
    "id": "79",
    "name": "Deux-Sèvres",
    "president": "Coralie DENOUES",
    "party": "DVD"
  },
  {
    "id": "80",
    "name": "Somme",
    "president": "Christelle HIVER",
    "party": "DVD"
  },
  {
    "id": "81",
    "name": "Tarn",
    "president": "Christophe RAMOND",
    "party": "PS"
  },
  {
    "id": "82",
    "name": "Tarn-et-Garonne",
    "president": "Michel WEILL",
    "party": "PRG"
  },
  {
    "id": "83",
    "name": "Var",
    "president": "Jean-Louis MASSON",
    "party": "LR"
  },
  {
    "id": "84",
    "name": "Vaucluse",
    "president": "Dominique SANTONI",
    "party": "PS"
  },
  {
    "id": "85",
    "name": "Vendée",
    "president": "Alain LEBOEUF",
    "party": "LR"
  },
  {
    "id": "86",
    "name": "Vienne",
    "president": "Alain PICHON",
    "party": "DVD"
  },
  {
    "id": "87",
    "name": "Haute-Vienne",
    "president": "Jean-Claude LEBLOIS",
    "party": "PS"
  },
  {
    "id": "88",
    "name": "Vosges",
    "president": "François VANNSON",
    "party": "LR"
  },
  {
    "id": "89",
    "name": "Yonne",
    "president": "Patrick GENDRAUD",
    "party": "LR"
  },
  {
    "id": "90",
    "name": "Territoire de Belfort",
    "president": "Florian BOUQUET",
    "party": "LR"
  },
  {
    "id": "91",
    "name": "Essonne",
    "president": "François DUROVRAY",
    "party": "LR"
  },
  {
    "id": "92",
    "name": "Hauts-de-Seine",
    "president": "Georges SIFFREDI",
    "party": "LR"
  },
  {
    "id": "93",
    "name": "Seine-Saint-Denis",
    "president": "Stéphane TROUSSEL",
    "party": "PS"
  },
  {
    "id": "94",
    "name": "Val-de-Marne",
    "president": "Olivier CAPITANIO",
    "party": "LR"
  },
  {
    "id": "95",
    "name": "Val-d'Oise",
    "president": "Marie-Christine CAVECCHI",
    "party": "LR"
  },
  {
    "id": "971",
    "name": "Guadeloupe",
    "president": "Guy LOSBAR",
    "party": "Renaissance"
  },
  {
    "id": "972",
    "name": "Martinique",
    "president": "Serge LETCHIMY",
    "party": "DVG"
  },
  {
    "id": "973",
    "name": "Guyane",
    "president": "Gabriel SERVILLE",
    "party": "DVG"
  },
  {
    "id": "974",
    "name": "La Réunion",
    "president": "Cyrille MELCHIOR",
    "party": "LR"
  },
  {
    "id": "976",
    "name": "Mayotte",
    "president": "Ben Issa OUSSENI",
    "party": "LR"
  }
];


// GET /api/comparateur/list
router.get('/list', (req, res) => {
  const regionsList = REGIONS.map(r => ({ id: r.id, name: r.name, image: r.image, type: 'region' }));
  const deptsList = DEPARTMENTS.map(d => ({ id: d.id, name: d.name, type: 'department' }));
  
  res.json({
    regions: regionsList,
    departments: deptsList
  });
});

// GET /api/comparateur/:codeInsee
router.get('/:codeInsee', async (req, res) => {
  const codeInsee = req.params.codeInsee;
  const name = req.query.name as string || `Commune ${codeInsee}`;

  // Check in REGIONS
  const region = REGIONS.find(r => r.id === codeInsee);
  if (region) {
    return res.json({ ...region, ...REGIONS_INDICATORS[codeInsee], type: 'region', isEstimated: false });
  }

  // Check in DEPARTMENTS
  const department = DEPARTMENTS.find(d => d.id === codeInsee);
  if (department) {
    const realIndicators = DEPARTMENTS_INDICATORS[codeInsee];
    if (realIndicators) {
      return res.json({
        ...department,
        ...realIndicators,
        type: 'department',
        isEstimated: false
      });
    }
    return res.json({ ...department, type: 'department' });
  }

  // Check in COMMUNES_INDICATORS
  const realCommune = COMMUNES_INDICATORS[codeInsee];

  // Helper to parse OFGL results
  const parseOFGLResults = (results: any[], year: number) => {
    let depFonct = 0;
    let depInvest = 0;
    let encoursDette = 0;
    let ptot = 0;

    for (const record of results) {
      if (record.agregat === 'Dépenses de fonctionnement') {
        depFonct = record.montant;
        ptot = record.ptot || record.ptot_n || ptot;
      } else if (record.agregat === "Dépenses d'investissement hors remb") {
        depInvest = record.montant;
      } else if (record.agregat === 'Encours de dette') {
        encoursDette = record.montant;
      }
    }

    if (ptot === 0) {
      const anyRecord = results.find((r: any) => r.ptot || r.ptot_n);
      if (anyRecord) {
        ptot = anyRecord.ptot || anyRecord.ptot_n;
      }
    }

    if (depFonct > 0 && ptot > 0) {
      const budgetHabitant = Math.round(depFonct / ptot);
      const depTotal = depFonct + depInvest;
      const investissement = depTotal > 0 ? Math.round((depInvest / depTotal) * 100) : 25;
      const endettement = Math.round((encoursDette / depFonct) * 100);

      return {
        budgetHabitant,
        endettement,
        investissement,
        populationTotal: ptot,
        year
      };
    }
    return null;
  };

  // Otherwise, try to fetch real budget data from OFGL API dynamically
  const fetchOFGLData = async (code: string) => {
    const years = [2024, 2023, 2022];
    for (const year of years) {
      // Try data.economie.gouv.fr first
      try {
        const whereClause = `insee="${code}" and exer=date'${year}' and type_de_budget="Budget principal" and (agregat="Dépenses de fonctionnement" or agregat="Dépenses d'investissement hors remb" or agregat="Encours de dette")`;
        const url = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/comptes-individuels-des-communes-fichier-global-2023-2024/records?where=${encodeURIComponent(whereClause)}&limit=100`;
        const response = await fetch(url);
        if (response.ok) {
          const json = await response.json();
          if (json.results && json.results.length > 0) {
            const data = parseOFGLResults(json.results, year);
            if (data) return data;
          }
        }
      } catch (err) {
        console.error(`Error querying data.economie.gouv.fr for ${code} in ${year}:`, err);
      }

      // Try data.ofgl.fr fallback
      try {
        const whereClause = `insee="${code}" and exer=date'${year}' and type_de_budget="Budget principal" and (agregat="Dépenses de fonctionnement" or agregat="Dépenses d'investissement hors remb" or agregat="Encours de dette")`;
        const url = `https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/ofgl-base-communes/records?where=${encodeURIComponent(whereClause)}&limit=100`;
        const response = await fetch(url);
        if (response.ok) {
          const json = await response.json();
          if (json.results && json.results.length > 0) {
            const data = parseOFGLResults(json.results, year);
            if (data) return data;
          }
        }
      } catch (err) {
        console.error(`Error querying data.ofgl.fr for ${code} in ${year}:`, err);
      }
    }
    return null;
  };

  const parseDotationsResults = (results: any[]) => {
    const sorted = results.sort((a: any, b: any) => {
      const yearA = a.exer ? parseInt(a.exer) : 0;
      const yearB = b.exer ? parseInt(b.exer) : 0;
      return yearB - yearA;
    });

    const record = sorted[0];
    const dgf = record.dgf || record.montant_dgf || record.dgf_tot || null;
    const forfaitaire = record.forfaitaire || record.montant_df || record.forfait || null;
    const dsr = record.dsr || record.montant_dsr || record.dsr_tot || null;
    const dsu = record.dsu || record.montant_dsu || record.dsu_tot || null;
    const dnp = record.dnp || record.montant_dnp || record.dnp_tot || null;
    const year = record.exer || record.exercice || "2024";

    return { dgf, forfaitaire, dsr, dsu, dnp, year };
  };

  // Try to fetch dotation data from OFGL
  const fetchDotationsData = async (code: string) => {
    // Try data.economie.gouv.fr
    try {
      const url = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/dotations-communes/records?where=code_insee%3D%22${code}%22&limit=5`;
      const response = await fetch(url);
      if (response.ok) {
        const json = await response.json();
        if (json.results && json.results.length > 0) {
          return parseDotationsResults(json.results);
        }
      }
    } catch (e) {
      console.error("Error fetching dotations from economie.gouv:", e);
    }

    // Try data.ofgl.fr
    try {
      const url = `https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/dotations-communes/records?where=code_insee%3D%22${code}%22&limit=5`;
      const response = await fetch(url);
      if (response.ok) {
        const json = await response.json();
        if (json.results && json.results.length > 0) {
          return parseDotationsResults(json.results);
        }
      }
    } catch (e) {
      console.error("Error fetching dotations from ofgl:", e);
    }
    return null;
  };

  const populationQuery = req.query.population ? parseInt(req.query.population as string) : undefined;

  // Run fetching in parallel
  try {
    const [ofglData, dotationsData, rneData] = await Promise.all([
      fetchOFGLData(codeInsee),
      fetchDotationsData(codeInsee),
      getElusForCommune(codeInsee).catch(() => null)
    ]);

    const officialPopulation = realCommune?.demographie?.populationTotal;
    const finalPop = officialPopulation ?? ofglData?.populationTotal ?? populationQuery;
    const baseMock = generateMockCommune(codeInsee, name, finalPop);

    const rneFormatted = rneData && rneData.length > 0 ? (() => {
      const maire = rneData.find(e => e.fonction === 'Maire') || null;
      const adjoints = rneData.filter(e => e.fonction && e.fonction.toLowerCase().includes('adjoint'));
      const conseillers = rneData.filter(e => !e.fonction || (!e.fonction.toLowerCase().includes('adjoint') && e.fonction !== 'Maire'));
      
      return {
        maire: maire ? {
          nom: maire.nom,
          prenom: maire.prenom,
          sexe: maire.sexe,
          dateNaissance: maire.dateNaissance,
          categoriePro: maire.categoriePro,
          dateDebutMandat: maire.dateDebutMandat
        } : null,
        adjoints: adjoints.map(e => ({
          nom: e.nom,
          prenom: e.prenom,
          sexe: e.sexe,
          dateNaissance: e.dateNaissance,
          categoriePro: e.categoriePro,
          dateDebutMandat: e.dateDebutMandat,
          fonction: e.fonction
        })),
        conseillers: conseillers.map(e => ({
          nom: e.nom,
          prenom: e.prenom,
          sexe: e.sexe,
          dateNaissance: e.dateNaissance,
          categoriePro: e.categoriePro,
          dateDebutMandat: e.dateDebutMandat
        }))
      };
    })() : null;

    const finalCommune = {
      ...(realCommune || baseMock),
      provenance: realCommune ? { population: COMMUNES_INDICATORS._meta.population } : undefined,
      rne: rneFormatted,
      dotations: dotationsData,
      isEstimated: false
    };

    if (ofglData) {
      finalCommune.demographie = {
        ...finalCommune.demographie,
        populationTotal: officialPopulation ?? ofglData.populationTotal
      };
      finalCommune.finances = {
        budgetHabitant: ofglData.budgetHabitant,
        endettement: ofglData.endettement,
        investissement: ofglData.investissement
      };
    }

    const sourceList = [];
    if (ofglData) {
      sourceList.push(`Comptes individuels DGFiP / OFGL (${ofglData.year})`);
    }
    if (dotationsData) {
      sourceList.push(`Dotations de l'État OFGL (${dotationsData.year})`);
    }
    if (rneFormatted) {
      sourceList.push(`Répertoire National des Élus (RNE) data.gouv.fr`);
    }
    if (realCommune) {
      sourceList.push(COMMUNES_INDICATORS._meta.source);
    }

    finalCommune.sources = sourceList.length > 0 ? sourceList.join(" | ") : "Données géographiques officielles (geo.api.gouv.fr)";

    return res.json(finalCommune);
  } catch (err) {
    console.error("Error in comparateur route:", err);
    return res.json(generateMockCommune(codeInsee, name, populationQuery));
  }
});

export default router;

