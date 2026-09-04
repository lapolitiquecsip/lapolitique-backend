// Forces politiques (fiches parti). Chaque force est reliée aux élus/candidats via
// `aliases` (sigles de groupes AN, groupes Sénat, noms de parti). `datanAbbrev`
// relie à un groupe de l'Assemblée (dataset datan) pour les statistiques.

export type PartySeed = {
  slug: string;
  name: string;
  abbrev: string;
  datanAbbrev?: string;   // libelleAbrev du groupe AN correspondant (stats datan)
  color?: string;         // couleur de repli si pas de groupe datan
  wikipedia: string;      // titre d'article Wikipédia (fr)
  aliases: string[];      // toutes les clés qui doivent pointer vers cette fiche
};

export const PARTY_SEED: PartySeed[] = [
  { slug: "rassemblement-national", name: "Rassemblement National", abbrev: "RN", datanAbbrev: "RN",
    wikipedia: "Rassemblement national", aliases: ["RN", "Rassemblement National"] },
  { slug: "renaissance", name: "Renaissance", abbrev: "RE", datanAbbrev: "EPR",
    wikipedia: "Renaissance (parti)", aliases: ["EPR", "RE", "Renaissance", "RDPI", "Ensemble pour la République"] },
  { slug: "la-france-insoumise", name: "La France Insoumise", abbrev: "LFI", datanAbbrev: "LFI-NFP",
    wikipedia: "La France insoumise", aliases: ["LFI-NFP", "LFI", "La France Insoumise"] },
  { slug: "parti-socialiste", name: "Parti Socialiste", abbrev: "PS", datanAbbrev: "SOC",
    wikipedia: "Parti socialiste (France)", aliases: ["SOC", "SER", "PS", "Parti Socialiste", "Place publique"] },
  { slug: "les-republicains", name: "Les Républicains", abbrev: "LR", datanAbbrev: "DR",
    wikipedia: "Les Républicains", aliases: ["DR", "LR", "Les Républicains"] },
  { slug: "les-ecologistes", name: "Les Écologistes — EELV", abbrev: "EELV", datanAbbrev: "ECOS",
    wikipedia: "Les Écologistes", aliases: ["EcoS", "ECOS", "GEST", "EELV", "EST", "Les Écologistes"] },
  { slug: "les-democrates", name: "Les Démocrates (MoDem)", abbrev: "MoDem", datanAbbrev: "DEM",
    wikipedia: "Mouvement démocrate (France)", aliases: ["Dem", "DEM", "MODEM", "Les Démocrates", "Mouvement Démocrate"] },
  { slug: "horizons", name: "Horizons", abbrev: "HOR", datanAbbrev: "HOR",
    wikipedia: "Horizons (parti politique)", aliases: ["HOR", "HORIZONS"] },
  { slug: "liot", name: "Libertés, Indépendants, Outre-mer et Territoires", abbrev: "LIOT", datanAbbrev: "LIOT",
    wikipedia: "Libertés, indépendants, outre-mer et territoires", aliases: ["LIOT"] },
  { slug: "parti-communiste-francais", name: "Parti Communiste Français", abbrev: "PCF", datanAbbrev: "GDR",
    wikipedia: "Parti communiste français", aliases: ["GDR", "CRCE-K", "CRCE", "PCF"] },
  { slug: "union-des-droites", name: "Union des Droites pour la République", abbrev: "UDR", datanAbbrev: "UDDPLR",
    wikipedia: "Union des droites pour la République", aliases: ["UDR", "UDDPLR"] },
  { slug: "union-centriste", name: "Union Centriste", abbrev: "UC", color: "#00A0E0",
    wikipedia: "Union des démocrates et indépendants", aliases: ["UC", "Union Centriste", "UDI", "Union des démocrates et indépendants"] },
  { slug: "rdse", name: "Rassemblement Démocratique et Social Européen", abbrev: "RDSE", color: "#E8B34A",
    wikipedia: "Rassemblement démocratique et social européen", aliases: ["RDSE"] },
  { slug: "les-independants", name: "Les Indépendants — République et Territoires", abbrev: "LIRT", color: "#26A69A",
    wikipedia: "Les Indépendants – République et Territoires", aliases: ["Les Indépendants", "LIRT"] },
  { slug: "non-inscrits", name: "Non-inscrits", abbrev: "NI", datanAbbrev: "NI", color: "#8D949A",
    wikipedia: "Non-inscrit", aliases: ["NI", "Non-inscrit", "Non inscrit"] },

  // Mouvements des candidat·e·s à la présidentielle 2027 non couverts ci-dessus (partis hors
  // groupes parlementaires « classiques »). Fiche complète via enrich-parties (Wikipédia/Wikidata).
  { slug: "nouvelle-energie", name: "Nouvelle Énergie", abbrev: "NE", color: "#0EA5A4",
    wikipedia: "Nouvelle Énergie", aliases: ["Nouvelle Énergie", "Nouvelle Energie"] },
  { slug: "generation-ecologie", name: "Génération Écologie", abbrev: "GE", color: "#22C55E",
    wikipedia: "Génération écologie", aliases: ["Génération écologie", "Génération Écologie", "GE"] },
  { slug: "debout-la-france", name: "Debout la France", abbrev: "DLF", color: "#1D4ED8",
    wikipedia: "Debout la France", aliases: ["Debout la France", "DLF"] },
  { slug: "les-patriotes", name: "Les Patriotes", abbrev: "LP", color: "#1E293B",
    wikipedia: "Les Patriotes (parti politique)", aliases: ["Les Patriotes"] },
  { slug: "union-populaire-republicaine", name: "Union Populaire Républicaine", abbrev: "UPR", color: "#B91C1C",
    wikipedia: "Union populaire républicaine (2007)", aliases: ["Union populaire républicaine", "UPR"] },
  { slug: "lutte-ouvriere", name: "Lutte Ouvrière", abbrev: "LO", color: "#DC2626",
    wikipedia: "Lutte ouvrière", aliases: ["Lutte ouvrière", "Lutte Ouvrière", "LO"] },
  { slug: "revolution-permanente", name: "Révolution Permanente", abbrev: "RP", color: "#991B1B",
    wikipedia: "Révolution permanente (organisation)", aliases: ["Révolution permanente"] },
  { slug: "union-democratique-bretonne", name: "Union Démocratique Bretonne", abbrev: "UDB", color: "#F59E0B",
    wikipedia: "Union démocratique bretonne", aliases: ["Union démocratique bretonne", "UDB"] },
  { slug: "nouveau-parti-anticapitaliste", name: "Nouveau Parti Anticapitaliste", abbrev: "NPA", color: "#E11D48",
    wikipedia: "Nouveau Parti anticapitaliste", aliases: ["NPA", "NPA – Révolutionnaires", "NPA - Révolutionnaires", "Nouveau Parti anticapitaliste"] },
  { slug: "la-convention", name: "La Convention", abbrev: "LC", color: "#DB2777",
    wikipedia: "La Convention", aliases: ["La Convention", "Socialiste (dissident)"] },
  { slug: "debout-ruffin", name: "Debout !", abbrev: "D!", color: "#EA580C",
    wikipedia: "Debout ! (parti politique)", aliases: ["Debout !", "Debout"] },
];
