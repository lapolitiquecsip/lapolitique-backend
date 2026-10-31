import { carrouselChiffre, carrouselVote, visuelBrief } from "../../lib/visuels/gabarits.js";
import { DOSSIER_ASSETS, rendreSlides } from "../../lib/visuels/rendu.js";

const sortie = process.argv[2];
const groupes = [
  ["RN", 98, 0, 0], ["EPR (Ensemble)", 89, 0, 0], ["LFI-NFP", 0, 0, 50], ["Socialistes", 0, 0, 54],
  ["Droite Républicaine", 44, 0, 0], ["Écologistes", 0, 0, 35], ["MoDem", 32, 0, 0], ["Horizons", 33, 0, 0],
  ["LIOT", 16, 0, 0], ["UDR (Ciotti)", 17, 0, 0], ["GDR", 3, 0, 12], ["Non-inscrits", 6, 0, 0],
].map(([nom, pour, contre, abstention]) => ({ nom: nom as string, pour: pour as number, contre: contre as number, abstention: abstention as number }));

const slides = [
  ...carrouselVote({
    adopte: true,
    titreCourt: "Réduire l'impact environnemental de l'industrie textile",
    date: "24 juin 2026",
    etape: "Texte de la commission mixte paritaire",
    numero: 7494, pour: 338, contre: 0, abstentions: 151, nonVotants: 1, groupes,
    mesures: [
      { titre: "Lutter contre la mode ultra-rapide", detail: "Le texte vise notamment la « fast fashion »." },
      { titre: "Un bonus-malus financier", detail: "Pour inciter les entreprises à des pratiques plus durables et responsables." },
    ],
    lienScrutin: "https://www.assemblee-nationale.fr/dyn/17/scrutins/7494",
  }, DOSSIER_ASSETS),
  ...carrouselChiffre({
    rubrique: "Chiffre officiel · Économie",
    accroche: "Le PIB a reculé.",
    valeur: "−0,1 %",
    sousTitre: "Au troisième trimestre 2026, selon l'INSEE.",
    comparaison: [{ periode: "T2 2026", valeur: "0 %" }, { periode: "T3 2026", valeur: "−0,1 %" }],
    explications: ["Le PIB a baissé de 0,1 % au troisième trimestre 2026.", "Il avait stagné au trimestre précédent."],
    source: "INSEE, série du produit intérieur brut",
    lienSource: "https://www.insee.fr/fr/statistiques/serie/011794844",
  }, DOSSIER_ASSETS),
  visuelBrief({
    titre: "Le PIB a reculé de 0,1 %.",
    sousTitre: "Au troisième trimestre 2026, selon l'INSEE.",
    colonnes: [{ valeur: "0 %", texte: "T2 2026" }, { valeur: "−0,1 %", texte: "T3 2026" }, { valeur: "INSEE", texte: "Source officielle" }],
  }),
];

console.log((await rendreSlides(slides, sortie, { channel: "chrome" })).join("\n"));
