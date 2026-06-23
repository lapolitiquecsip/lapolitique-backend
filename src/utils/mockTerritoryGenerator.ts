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

  return {
    id: codeInsee,
    name: name,
    type: "commune",
    isEstimated: true, // Badge trigger
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
