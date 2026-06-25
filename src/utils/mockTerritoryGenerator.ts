export const generateMockCommune = (codeInsee: string, name: string, population?: number) => {
  return {
    id: codeInsee,
    name: name,
    type: "commune",
    isEstimated: true, // Badge trigger
    grandsTravaux: [], // No mock projects
    evenements: [], // No mock events
    demographie: { 
      populationTotal: population !== undefined ? population : null, 
      densite: null, 
      evolution10ans: null, 
      moins25ans: null, 
      plus65ans: null 
    },
    economie: { 
      chomage: null, 
      revenuMedian: null, 
      pauvrete: null 
    },
    education: { 
      bac: null, 
      diplomesSup: null, 
      decrochage: null 
    },
    sante: { 
      medecins10k: null, 
      scoreAPL: null, 
      esperanceVie: null 
    },
    securite: { 
      atteintesPersonnes: null, 
      atteintesBiens: null 
    },
    logement: { 
      prixM2: null, 
      logementsSociaux: null, 
      proprietaires: null 
    },
    politique: { 
      pres2022T1: null, 
      pres2022T2: null, 
      participation: null, 
      elu: null, 
      eluDepuis: null 
    },
    finances: { 
      budgetHabitant: null, 
      endettement: null, 
      investissement: null 
    },
    fiscalite: {
      tauxTF: null,
      tauxTH: null
    },
    environnement: { 
      qualiteAir: null, 
      surfaceNaturelle: null, 
      risques: null 
    }
  };
};
