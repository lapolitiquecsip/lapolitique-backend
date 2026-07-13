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
    wikipedia: "Parti socialiste (France)", aliases: ["SOC", "SER", "PS", "Parti Socialiste"] },
  { slug: "les-republicains", name: "Les Républicains", abbrev: "LR", datanAbbrev: "DR",
    wikipedia: "Les Républicains", aliases: ["DR", "LR", "Les Républicains"] },
  { slug: "les-ecologistes", name: "Les Écologistes — EELV", abbrev: "EELV", datanAbbrev: "ECOS",
    wikipedia: "Les Écologistes", aliases: ["EcoS", "ECOS", "GEST", "EELV", "EST", "Les Écologistes"] },
  { slug: "les-democrates", name: "Les Démocrates (MoDem)", abbrev: "MoDem", datanAbbrev: "DEM",
    wikipedia: "Mouvement démocrate (France)", aliases: ["Dem", "DEM", "MODEM", "Les Démocrates"] },
  { slug: "horizons", name: "Horizons", abbrev: "HOR", datanAbbrev: "HOR",
    wikipedia: "Horizons (parti politique)", aliases: ["HOR", "HORIZONS"] },
  { slug: "liot", name: "Libertés, Indépendants, Outre-mer et Territoires", abbrev: "LIOT", datanAbbrev: "LIOT",
    wikipedia: "Libertés, indépendants, outre-mer et territoires", aliases: ["LIOT"] },
  { slug: "parti-communiste-francais", name: "Parti Communiste Français", abbrev: "PCF", datanAbbrev: "GDR",
    wikipedia: "Parti communiste français", aliases: ["GDR", "CRCE-K", "CRCE", "PCF"] },
  { slug: "union-des-droites", name: "Union des Droites pour la République", abbrev: "UDR", datanAbbrev: "UDDPLR",
    wikipedia: "Union des droites pour la République", aliases: ["UDR", "UDDPLR"] },
  { slug: "union-centriste", name: "Union Centriste", abbrev: "UC", color: "#00A0E0",
    wikipedia: "Union des démocrates et indépendants", aliases: ["UC", "Union Centriste", "UDI"] },
  { slug: "rdse", name: "Rassemblement Démocratique et Social Européen", abbrev: "RDSE", color: "#E8B34A",
    wikipedia: "Rassemblement démocratique et social européen", aliases: ["RDSE"] },
  { slug: "les-independants", name: "Les Indépendants — République et Territoires", abbrev: "LIRT", color: "#26A69A",
    wikipedia: "Les Indépendants – République et Territoires", aliases: ["Les Indépendants", "LIRT"] },
  { slug: "non-inscrits", name: "Non-inscrits", abbrev: "NI", datanAbbrev: "NI", color: "#8D949A",
    wikipedia: "Non-inscrit", aliases: ["NI", "Non-inscrit", "Non inscrit"] },
];
