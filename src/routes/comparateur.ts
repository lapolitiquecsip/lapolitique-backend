import { Router } from 'express';
import { generateMockCommune } from '../utils/mockTerritoryGenerator.js';

const router = Router();

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
    finances: { budgetHabitant: 427, endettement: 65, investissement: 30 },
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
    finances: { budgetHabitant: 500, endettement: 55, investissement: 35 },
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
    finances: { budgetHabitant: 633, endettement: 70, investissement: 25 },
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
    finances: { budgetHabitant: 590, endettement: 58, investissement: 32 },
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
    finances: { budgetHabitant: 581, endettement: 62, investissement: 34 },
    environnement: { qualiteAir: 70, surfaceNaturelle: 80, risques: "élevé" },
  },
  {
    id: "44", name: "Grand Est", president: "Franck Leroy", party: "LR", image: "/images/regions/grand_est.png",
    demographie: { populationTotal: 5600000, densite: 97, evolution10ans: "+0.2%", moins25ans: 29, plus65ans: 21 },
    economie: { chomage: 7.2, revenuMedian: 2180, pauvrete: 14 },
    education: { bac: 88, diplomesSup: 32, decrochage: 10 },
    sante: { medecins10k: 27, scoreAPL: 58, esperanceVie: 81.8 },
    securite: { atteintesPersonnes: 8, atteintesBiens: 23 },
    logement: { prixM2: 2000, logementsSociaux: 19, proprietaires: 59 },
    politique: { pres2022T1: "Le Pen 29%, Macron 27%, Mélenchon 19%", pres2022T2: "Macron 52%, Le Pen 48%", participation: 73, elu: "Franck Leroy (LR)", eluDepuis: "2023" },
    finances: { budgetHabitant: 801, endettement: 68, investissement: 28 },
    environnement: { qualiteAir: 60, surfaceNaturelle: 78, risques: "faible" },
  },
  {
    id: "93", name: "Provence-Alpes-Côte d'Azur", president: "Renaud Muselier", party: "LR", image: "/images/regions/paca.png",
    demographie: { populationTotal: 5200000, densite: 165, evolution10ans: "+2.8%", moins25ans: 27, plus65ans: 24 },
    economie: { chomage: 7.8, revenuMedian: 2200, pauvrete: 16 },
    education: { bac: 87, diplomesSup: 35, decrochage: 11 },
    sante: { medecins10k: 38, scoreAPL: 80, esperanceVie: 83.2 },
    securite: { atteintesPersonnes: 11, atteintesBiens: 32 },
    logement: { prixM2: 4200, logementsSociaux: 12, proprietaires: 54 },
    politique: { pres2022T1: "Le Pen 27%, Macron 23%, Mélenchon 20%", pres2022T2: "Macron 50.5%, Le Pen 49.5%", participation: 74, elu: "Renaud Muselier (LR)", eluDepuis: "2017" },
    finances: { budgetHabitant: 615, endettement: 60, investissement: 31 },
    environnement: { qualiteAir: 65, surfaceNaturelle: 68, risques: "élevé" },
  },
  {
    id: "52", name: "Pays de la Loire", president: "Christelle Morançais", party: "LR", image: "/images/regions/pays_de_la_loire.png",
    demographie: { populationTotal: 3900000, densite: 121, evolution10ans: "+5.1%", moins25ans: 30, plus65ans: 21 },
    economie: { chomage: 5.8, revenuMedian: 2220, pauvrete: 11 },
    education: { bac: 91, diplomesSup: 35, decrochage: 8 },
    sante: { medecins10k: 24, scoreAPL: 50, esperanceVie: 82.9 },
    securite: { atteintesPersonnes: 7, atteintesBiens: 21 },
    logement: { prixM2: 2600, logementsSociaux: 15, proprietaires: 63 },
    politique: { pres2022T1: "Macron 33%, Mélenchon 21%, Le Pen 20%", pres2022T2: "Macron 64%, Le Pen 36%", participation: 78, elu: "Christelle Morançais (LR)", eluDepuis: "2017" },
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
    finances: { budgetHabitant: 666, endettement: 59, investissement: 33 },
    environnement: { qualiteAir: 70, surfaceNaturelle: 82, risques: "modéré" },
  },
  {
    id: "53", name: "Bretagne", president: "Loïg Chesnais-Girard", party: "PS", image: "/images/regions/bretagne.png",
    demographie: { populationTotal: 3400000, densite: 124, evolution10ans: "+4.5%", moins25ans: 28, plus65ans: 23 },
    economie: { chomage: 5.5, revenuMedian: 2250, pauvrete: 10 },
    education: { bac: 92, diplomesSup: 38, decrochage: 7 },
    sante: { medecins10k: 26, scoreAPL: 55, esperanceVie: 83.1 },
    securite: { atteintesPersonnes: 6, atteintesBiens: 18 },
    logement: { prixM2: 2800, logementsSociaux: 11, proprietaires: 66 },
    politique: { pres2022T1: "Macron 32%, Mélenchon 22%, Le Pen 19%", pres2022T2: "Macron 66%, Le Pen 34%", participation: 79, elu: "Loïg Chesnais-Girard (PS)", eluDepuis: "2017" },
    finances: { budgetHabitant: 567, endettement: 50, investissement: 38 },
    environnement: { qualiteAir: 80, surfaceNaturelle: 84, risques: "faible" },
  },
  {
    id: "27", name: "Bourgogne-Franche-Comté", president: "Marie-Guite Dufay", party: "PS", image: "/images/regions/bourgogne_franche_comte.png",
    demographie: { populationTotal: 2800000, densite: 58, evolution10ans: "-0.5%", moins25ans: 27, plus65ans: 24 },
    economie: { chomage: 6.2, revenuMedian: 2180, pauvrete: 12 },
    education: { bac: 88, diplomesSup: 32, decrochage: 9 },
    sante: { medecins10k: 25, scoreAPL: 52, esperanceVie: 82.2 },
    securite: { atteintesPersonnes: 6, atteintesBiens: 19 },
    logement: { prixM2: 1700, logementsSociaux: 16, proprietaires: 64 },
    politique: { pres2022T1: "Le Pen 27%, Macron 26%, Mélenchon 18%", pres2022T2: "Macron 52%, Le Pen 48%", participation: 76, elu: "Marie-Guite Dufay (PS)", eluDepuis: "2016" },
    finances: { budgetHabitant: 607, endettement: 56, investissement: 30 },
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
    finances: { budgetHabitant: 615, endettement: 58, investissement: 31 },
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
    finances: { budgetHabitant: 2571, endettement: 60, investissement: 28 },
    environnement: { qualiteAir: 85, surfaceNaturelle: 90, risques: "élevé" },
  }
];

const DEPARTMENTS = [
  {
    "id": "01",
    "name": "Ain",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "02",
    "name": "Aisne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "03",
    "name": "Allier",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "04",
    "name": "Alpes-de-Haute-Provence",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "05",
    "name": "Hautes-Alpes",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "06",
    "name": "Alpes-Maritimes",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "07",
    "name": "Ardèche",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "08",
    "name": "Ardennes",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "09",
    "name": "Ariège",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "10",
    "name": "Aube",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "11",
    "name": "Aude",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "12",
    "name": "Aveyron",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "13",
    "name": "Bouches-du-Rhône",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "14",
    "name": "Calvados",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "15",
    "name": "Cantal",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "16",
    "name": "Charente",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "17",
    "name": "Charente-Maritime",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "18",
    "name": "Cher",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "19",
    "name": "Corrèze",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "21",
    "name": "Côte-d'Or",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "22",
    "name": "Côtes-d'Armor",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "23",
    "name": "Creuse",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "24",
    "name": "Dordogne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "25",
    "name": "Doubs",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "26",
    "name": "Drôme",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "27",
    "name": "Eure",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "28",
    "name": "Eure-et-Loir",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "29",
    "name": "Finistère",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "2A",
    "name": "Corse-du-Sud",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "2B",
    "name": "Haute-Corse",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "30",
    "name": "Gard",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "31",
    "name": "Haute-Garonne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "32",
    "name": "Gers",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "33",
    "name": "Gironde",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "34",
    "name": "Hérault",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "35",
    "name": "Ille-et-Vilaine",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "36",
    "name": "Indre",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "37",
    "name": "Indre-et-Loire",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "38",
    "name": "Isère",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "39",
    "name": "Jura",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "40",
    "name": "Landes",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "41",
    "name": "Loir-et-Cher",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "42",
    "name": "Loire",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "43",
    "name": "Haute-Loire",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "44",
    "name": "Loire-Atlantique",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "45",
    "name": "Loiret",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "46",
    "name": "Lot",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "47",
    "name": "Lot-et-Garonne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "48",
    "name": "Lozère",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "49",
    "name": "Maine-et-Loire",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "50",
    "name": "Manche",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "51",
    "name": "Marne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "52",
    "name": "Haute-Marne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "53",
    "name": "Mayenne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "54",
    "name": "Meurthe-et-Moselle",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "55",
    "name": "Meuse",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "56",
    "name": "Morbihan",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "57",
    "name": "Moselle",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "58",
    "name": "Nièvre",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "59",
    "name": "Nord",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "60",
    "name": "Oise",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "61",
    "name": "Orne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "62",
    "name": "Pas-de-Calais",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "63",
    "name": "Puy-de-Dôme",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "64",
    "name": "Pyrénées-Atlantiques",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "65",
    "name": "Hautes-Pyrénées",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "66",
    "name": "Pyrénées-Orientales",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "67",
    "name": "Bas-Rhin",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "68",
    "name": "Haut-Rhin",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "69",
    "name": "Rhône",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "70",
    "name": "Haute-Saône",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "71",
    "name": "Saône-et-Loire",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "72",
    "name": "Sarthe",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "73",
    "name": "Savoie",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "74",
    "name": "Haute-Savoie",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "75",
    "name": "Paris",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "76",
    "name": "Seine-Maritime",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "77",
    "name": "Seine-et-Marne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "78",
    "name": "Yvelines",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "79",
    "name": "Deux-Sèvres",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "80",
    "name": "Somme",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "81",
    "name": "Tarn",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "82",
    "name": "Tarn-et-Garonne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "83",
    "name": "Var",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "84",
    "name": "Vaucluse",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "85",
    "name": "Vendée",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "86",
    "name": "Vienne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "87",
    "name": "Haute-Vienne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "88",
    "name": "Vosges",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "89",
    "name": "Yonne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "90",
    "name": "Territoire de Belfort",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "91",
    "name": "Essonne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "92",
    "name": "Hauts-de-Seine",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "93",
    "name": "Seine-Saint-Denis",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "94",
    "name": "Val-de-Marne",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "95",
    "name": "Val-d'Oise",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "971",
    "name": "Guadeloupe",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "972",
    "name": "Martinique",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "973",
    "name": "Guyane",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "974",
    "name": "La Réunion",
    "president": "Président du Conseil",
    "party": "N/A"
  },
  {
    "id": "976",
    "name": "Mayotte",
    "president": "Président du Conseil",
    "party": "N/A"
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
router.get('/:codeInsee', (req, res) => {
  const codeInsee = req.params.codeInsee;
  const name = req.query.name as string || `Commune ${codeInsee}`;

  // Check in REGIONS
  const region = REGIONS.find(r => r.id === codeInsee);
  if (region) {
    // Ensure regions have indicators (they should, but just in case)
    return res.json({ ...region, type: 'region' });
  }

  // Check in DEPARTMENTS
  const department = DEPARTMENTS.find(d => d.id === codeInsee);
  if (department) {
    // Departments from the 101 list might not have indicators yet
    // Generate mock indicators for them if missing
    if (!(department as any).demographie) {
      const mockIndicators = generateMockCommune(codeInsee, name);
      return res.json({ ...department, ...mockIndicators, type: 'department', isEstimated: true });
    }
    return res.json({ ...department, type: 'department' });
  }

  // Otherwise, it's a commune or an unknown code. We generate mock data.
  const mockData = generateMockCommune(codeInsee, name);
  return res.json(mockData);
});

export default router;
