/**
 * Groupe de vote de chaque parti suivi, à l'Assemblée (code d'organe PO de l'open data AN,
 * comme src/lib/data/partyGroups.ts du site) et au Sénat (senators.senate_group).
 *
 * Au Sénat, le groupe n'est pas le parti : on y nomme le groupe où siègent ses élus
 * (l'Union centriste pour le MoDem, UNT pour le RN et l'UDR). LFI et LIOT n'y ont pas de groupe.
 * À revoir après chaque renouvellement (sénatoriales, législatives).
 */
export const GROUPES_PARTIS: Record<string, { an?: { po: string; nom: string }; senat?: { code: string; nom: string } }> = {
  "rassemblement-national": { an: { po: "PO845401", nom: "Le RN" }, senat: { code: "UNT", nom: "Le groupe UNT (RN, UDR)" } },
  "la-france-insoumise": { an: { po: "PO845413", nom: "LFI" } },
  "parti-socialiste": { an: { po: "PO845419", nom: "Le groupe socialiste" }, senat: { code: "SER", nom: "Le groupe socialiste (SER)" } },
  "renaissance": { an: { po: "PO845407", nom: "Ensemble pour la République" }, senat: { code: "RDPI", nom: "Le groupe RDPI (Renaissance)" } },
  "les-republicains": { an: { po: "PO845425", nom: "La Droite républicaine" }, senat: { code: "Les Républicains", nom: "Le groupe Les Républicains" } },
  "les-democrates": { an: { po: "PO845454", nom: "Les Démocrates (MoDem)" }, senat: { code: "UC", nom: "L'Union centriste (MoDem)" } },
  "horizons": { an: { po: "PO845470", nom: "Horizons" }, senat: { code: "Les Indépendants", nom: "Les Indépendants (Horizons)" } },
  "parti-communiste-francais": { an: { po: "PO845514", nom: "La GDR (communistes)" }, senat: { code: "CRCE-K", nom: "Le groupe CRCE-K (communistes)" } },
  "liot": { an: { po: "PO845485", nom: "Le groupe LIOT" } },
  "les-ecologistes": { an: { po: "PO845439", nom: "Les Écologistes" }, senat: { code: "GEST", nom: "Le groupe écologiste (GEST)" } },
  "union-des-droites": { an: { po: "PO872880", nom: "L'UDR (Ciotti)" }, senat: { code: "UNT", nom: "Le groupe UNT (RN, UDR)" } },
};

export type PositionGroupe = { position: "pour" | "contre" | "abstention" | "partage" | "absent"; pour: number; contre: number; abstention: number };

/** Position majoritaire d'un groupe : « divisé » si aucune position ne réunit les deux tiers des votants. */
export function positionGroupe(pour = 0, contre = 0, abstention = 0): PositionGroupe {
  const n = pour + contre + abstention;
  if (!n) return { position: "absent", pour, contre, abstention };
  const max = Math.max(pour, contre, abstention);
  const position = max / n < 2 / 3 ? "partage" : max === pour ? "pour" : max === contre ? "contre" : "abstention";
  return { position, pour, contre, abstention };
}
