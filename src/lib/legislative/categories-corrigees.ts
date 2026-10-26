import type { LegislativeCategory } from "./normalization.js";

// Corrections manuelles du classement thématique, par identifiant officiel du dossier.
// Les synchronisations Assemblée et Sénat recalculent la catégorie à chaque passage : une
// correction faite directement en base serait écrasée dans l'heure. On la consigne donc ici
// (classifyDossier la fait primer sur le classeur), puis
// `npm run automation:legislative:reclasser -- --apply` la répercute en base.
//   Exemple : "DLR5L17N12345": "environment_agriculture",
//             "SENAT:ppl25-446": "social_labour",
export const CATEGORIES_CORRIGEES: Record<string, LegislativeCategory> = {
};
