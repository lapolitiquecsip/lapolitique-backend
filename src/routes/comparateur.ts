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
    id: "75", name: "Paris", president: "Anne Hidalgo", party: "PS",
    demographie: { populationTotal: 2100000, densite: 20300, evolution10ans: "-5.0%", moins25ans: 28, plus65ans: 15 },
    economie: { chomage: 5.5, revenuMedian: 3000, pauvrete: 15 },
    education: { bac: 94, diplomesSup: 60, decrochage: 5 },
    sante: { medecins10k: 55, scoreAPL: 90, esperanceVie: 84 },
    securite: { atteintesPersonnes: 15, atteintesBiens: 45 },
    logement: { prixM2: 10000, logementsSociaux: 24, proprietaires: 33 },
    politique: { pres2022T1: "Macron 35%, Mélenchon 30%, Zemmour 8%", pres2022T2: "Macron 85%, Le Pen 15%", participation: 76, elu: "Anne Hidalgo (PS)", eluDepuis: "2014" },
    finances: { budgetHabitant: 5000, endettement: 85, investissement: 25 },
    environnement: { qualiteAir: 45, surfaceNaturelle: 5, risques: "faible" },
  },
  {
    id: "69", name: "Rhône", president: "Christophe Guilloteau", party: "LR",
    demographie: { populationTotal: 468000, densite: 175, evolution10ans: "+3.5%", moins25ans: 30, plus65ans: 18 },
    economie: { chomage: 6.2, revenuMedian: 2350, pauvrete: 11 },
    education: { bac: 91, diplomesSup: 42, decrochage: 7 },
    sante: { medecins10k: 32, scoreAPL: 70, esperanceVie: 83 },
    securite: { atteintesPersonnes: 9, atteintesBiens: 28 },
    logement: { prixM2: 3000, logementsSociaux: 18, proprietaires: 58 },
    politique: { pres2022T1: "Macron 32%, Mélenchon 25%, Le Pen 18%", pres2022T2: "Macron 68%, Le Pen 32%", participation: 78, elu: "Christophe Guilloteau (LR)", eluDepuis: "2015" },
    finances: { budgetHabitant: 1164, endettement: 55, investissement: 32 },
    environnement: { qualiteAir: 60, surfaceNaturelle: 60, risques: "modéré" },
  },
  {
    id: "13", name: "Bouches-du-Rhône", president: "Martine Vassal", party: "DVD",
    demographie: { populationTotal: 2000000, densite: 395, evolution10ans: "+2.0%", moins25ans: 29, plus65ans: 21 },
    economie: { chomage: 8.5, revenuMedian: 2150, pauvrete: 17 },
    education: { bac: 86, diplomesSup: 32, decrochage: 12 },
    sante: { medecins10k: 38, scoreAPL: 75, esperanceVie: 82.5 },
    securite: { atteintesPersonnes: 12, atteintesBiens: 35 },
    logement: { prixM2: 3500, logementsSociaux: 15, proprietaires: 52 },
    politique: { pres2022T1: "Mélenchon 26%, Le Pen 25%, Macron 22%", pres2022T2: "Macron 52%, Le Pen 48%", participation: 72, elu: "Martine Vassal (DVD)", eluDepuis: "2015" },
    finances: { budgetHabitant: 1425, endettement: 62, investissement: 28 },
    environnement: { qualiteAir: 55, surfaceNaturelle: 50, risques: "élevé" },
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
    return res.json({ ...region, type: 'region' });
  }

  // Check in DEPARTMENTS
  const department = DEPARTMENTS.find(d => d.id === codeInsee);
  if (department) {
    return res.json({ ...department, type: 'department' });
  }

  // Otherwise, it's a commune or an unknown code. We generate mock data.
  const mockData = generateMockCommune(codeInsee, name);
  return res.json(mockData);
});

export default router;
