export const generateMockCommune = (codeInsee: string, name: string, population?: number) => {
  // Simple deterministic pseudo-random generator based on codeInsee
  const hash = codeInsee.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  
  const random = (min: number, max: number) => {
    return min + ((hash * 9301 + 49297) % 233280) / 233280 * (max - min);
  };

  const pop = population !== undefined ? population : Math.floor(random(500, 50000));
  const densite = Math.floor(random(20, 2000));
  const chomage = parseFloat(random(4, 15).toFixed(1));
  const revenuMedian = Math.floor(random(1600, 3500));
  const bac = Math.floor(random(75, 98));

  // Deterministic mock projects selection
  const poolProjects = [
    { title: "Rénovation thermique de l'école", desc: "Amélioration énergétique et isolation par l'extérieur de l'école primaire.", cost: "1,2 M€", status: "En cours" },
    { title: "Liaisons douces & Pistes cyclables", desc: "Création d'une liaison cyclable sécurisée pour relier le centre-bourg.", cost: "450 k€", status: "Finalisation" },
    { title: "Végétalisation du centre-ville", desc: "Plantation d'arbres et désimperméabilisation des places centrales.", cost: "250 k€", status: "Lancement 2026" },
    { title: "Modernisation de l'éclairage public", desc: "Remplacement de l'ensemble du parc lumineux par des ampoules LED.", cost: "180 k€", status: "En cours" },
    { title: "Réhabilitation de la salle des fêtes", desc: "Remise aux normes d'accessibilité et de confort acoustique.", cost: "750 k€", status: "En cours" },
    { title: "Aménagement d'une aire de jeux", desc: "Création d'un espace de jeux inclusif pour enfants dans le parc municipal.", cost: "120 k€", status: "Finalisation" },
    { title: "Restauration du patrimoine local", desc: "Travaux de sauvegarde et de maçonnerie sur l'église historique.", cost: "320 k€", status: "En cours" }
  ];

  const poolEvents = [
    { title: "Fête locale de la Saint-Jean", desc: "Feux traditionnels, fête foraine et concerts gratuits en plein air.", date: "Juin", category: "Tradition" },
    { title: "Marché de Noël des artisans", "desc": "Chalet d'exposants locaux, patinoire éphémère et défilé lumineux.", date: "Décembre", category: "Tradition" },
    { title: "Festival culturel des arts de rue", desc: "Spectacles de saltimbanques, théâtre de marionnettes et fanfares.", date: "Juillet", category: "Culture" },
    { title: "Fête de la Musique", desc: "Podiums amateurs dans le centre et restauration associative sur place.", date: "Juin", category: "Musique" },
    { title: "Vide-grenier & Brocante", desc: "Plus de 200 exposants de particuliers et stands de restauration locale.", date: "Mai", category: "Festivités" },
    { title: "Trail & Course nature", desc: "Courses de 5km, 10km et randonnées dans les sentiers communaux.", date: "Octobre", category: "Sport" },
    { title: "Forum des associations", desc: "Présentation des activités sportives, artistiques et d'entraide locales.", date: "Septembre", category: "Festivités" },
    { title: "Cinéma en plein air", desc: "Projection gratuite de films familiaux sur écran géant au coucher du soleil.", date: "Août", category: "Culture" }
  ];

  // Select 3 items from each pool deterministically based on hash
  const grandsTravaux = [];
  const evenements = [];
  
  for (let i = 0; i < 3; i++) {
    const projectIndex = Math.floor(random(0, poolProjects.length - 0.001) + i) % poolProjects.length;
    // Prevent duplicates
    if (!grandsTravaux.includes(poolProjects[projectIndex])) {
      grandsTravaux.push(poolProjects[projectIndex]);
    }
    
    const eventIndex = Math.floor(random(0, poolEvents.length - 0.001) + i) % poolEvents.length;
    // Prevent duplicates
    if (!evenements.includes(poolEvents[eventIndex])) {
      evenements.push(poolEvents[eventIndex]);
    }
  }

  return {
    id: codeInsee,
    name: name,
    type: "commune",
    isEstimated: true, // Badge trigger
    grandsTravaux,
    evenements,
    demographie: { 
      populationTotal: pop, 
      densite, 
      evolution10ans: `${(random(-5, 15)).toFixed(1)}%`, 
      moins25ans: Math.floor(random(20, 40)), 
      plus65ans: Math.floor(random(15, 35)) 
    },
    economie: { 
      chomage, 
      revenuMedian, 
      pauvrete: Math.floor(random(5, 25)) 
    },
    education: { 
      bac, 
      diplomesSup: Math.floor(random(15, 50)), 
      decrochage: Math.floor(random(3, 15)) 
    },
    sante: { 
      medecins10k: Math.floor(random(5, 40)), 
      scoreAPL: Math.floor(random(30, 95)), 
      esperanceVie: parseFloat(random(78, 85).toFixed(1)) 
    },
    securite: { 
      atteintesPersonnes: Math.floor(random(2, 20)), 
      atteintesBiens: Math.floor(random(10, 60)) 
    },
    logement: { 
      prixM2: Math.floor(random(1000, 6000)), 
      logementsSociaux: Math.floor(random(0, 35)), 
      proprietaires: Math.floor(random(40, 80)) 
    },
    politique: { 
      pres2022T1: "Macron 28%, Le Pen 25%, Mélenchon 20%", 
      pres2022T2: "Macron 55%, Le Pen 45%", 
      participation: Math.floor(random(65, 85)), 
      elu: "Maire", 
      eluDepuis: "2020" 
    },
    finances: { 
      budgetHabitant: Math.floor(random(300, 1500)), 
      endettement: Math.floor(random(20, 120)), 
      investissement: Math.floor(random(10, 40)) 
    },
    environnement: { 
      qualiteAir: Math.floor(random(40, 90)), 
      surfaceNaturelle: Math.floor(random(20, 95)), 
      risques: random(0, 1) > 0.5 ? "modéré" : "faible" 
    }
  };
};
