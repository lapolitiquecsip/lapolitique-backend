# Charte Instagram de Rose (v3, 26/11/2026)

Rose (graphiste) n'est pas une IA : c'est la mise en page de `src/lib/visuels/charte.ts`, rendue par
`src/lib/visuels/rendu.ts`. Elle reçoit un contenu déjà écrit (Basile, ou les données du site) et le
place dans la charte. Elle n'invente rien.

Référence : la consigne écrite avec ChatGPT par Hippolyte (`docs/consigne-design-instagram-chatgpt.md`),
appliquée avec les arbitrages ci-dessous.

## Repris de la consigne
- Gabarit A « Programme [Prénom Nom] » : couverture (PROGRAMME, prénom, nom dans un cartouche, trait,
  accroche si la page existe, bandeau « Voici un aperçu de ses idées → », portrait à droite à fond perdu),
  slides intérieures (attribution, titre, trait, 2-3 mesures numérotées, objet en bas à droite, pied avec
  site + « Propositions du programme » + source), dernière slide (« Suis les candidats à la présidentielle
  sur notre site », grande capture de la fiche + programme + parcours, bandeau lien en bio).
- Gabarit B « Les programmes en détail » : 9:16 et 4:5, question en 3-4 lignes, thème seul dans un
  cartouche arrondi, ligne de contexte, objet à gauche, portrait à droite, site en bas à gauche, sans compteur.
- Couleurs exactes des 4 palettes, Anton pour les titres, League Spartan pour le texte, marges de 70 px,
  texte de 32 à 40 px (jamais sous 30 : au-delà, répartition sur deux slides), un seul cartouche, grain fin.
- Objet réduit puis retiré s'il gêne un texte ; trois traits d'accent près de l'objet.

## Arbitré par Hippolyte (26/11)
- **4 palettes en rotation** d'un post à l'autre (rose, cobalt, ciel, bordeaux), jamais attribuées à un
  candidat ou à un parti (la consigne en donnait une par candidat).
- **Logo officiel** : le temple SANS flèche (« LOGO LPCS UNE BONNE FOIS POUR TOUTE »), recoloré.

## Corrigé (sécurité et faisabilité)
- Pas de génération d'image pour le détourage ni pour les portraits : une IA d'image redessine le visage.
  Portraits = vraies photos détourées par `scripts/visuels/detourer.py`.
- Export JPEG (et non PNG) : seul format accepté par l'API de publication d'Instagram.
- La famille « actu » (bleu électrique, menthe, papier déchiré), absente de la consigne, est gardée.
- La partie éditoriale de la consigne (angle, condensation sans changer le sens, proposition ≠ mesure en
  vigueur, source par slide, rien de supposé, liste « à vérifier ») va au prompt de Basile (rédacteur).
