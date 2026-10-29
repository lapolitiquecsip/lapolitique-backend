# Cycles d'agents

Mis en place le 11 octobre 2026 en mode d'observation. Depuis le 29 octobre 2026, le cycle
« programmes » **publie seul** les brouillons validés par le vérificateur (demande de l'éditeur).

## Le principe

Un **cycle** est une chaîne d'agents qui se passent le relais. Chaque agent ne fait qu'une
chose, et la fait pour tous les objets arrivés à son étape. Le relais est une table,
`cycle_items` : un agent y lit ce que le précédent a laissé, y pose son travail, et le suivant
le prend. Personne n'appelle personne.

Ce que cela change par rapport aux tâches d'avant, qui faisaient tout d'un bloc :

- **Rien ne disparaît en silence.** Chaque objet a une ligne, avec son étape et le motif de
  son blocage. Avant, une page qui répondait 503 était sautée et personne ne le savait.
- **Une panne reste locale.** Le rédacteur à court de quota n'empêche ni le veilleur de
  détecter, ni le contrôleur d'alerter. Il reprendra où il s'était arrêté.
- **Celui qui écrit n'est pas celui qui valide.** Le vérificateur n'utilise aucune IA : il
  confronte le brouillon au texte source.
- **Chaque agent peut avoir son modèle.** Détecter ne demande aucune IA ; rédiger en demande
  une bonne ; vérifier se fait par comparaison de texte. On paie le modèle là où il sert.

## Cycle « programmes des candidats »

| Agent | Tâche unique | IA | Fichier |
|---|---|---|---|
| Veilleur | Remarquer une parution : nouvelle page sous un index officiel surveillé ; annonce relayée par au moins trois médias | non | `agents/programmes-veilleur.ts` |
| Rédacteur | Tirer un brouillon de la page (thèmes, contexte, propositions), avec la consigne qui a produit la fiche Lisnard | oui | `agents/programmes-redacteur.ts` |
| Vérificateur | Retirer toute proposition dont un chiffre ou les mots ne se retrouvent pas dans un même passage de la source | non | `agents/programmes-verificateur.ts` |
| Mise en ligne | Écrire sur la fiche les seules lignes de cette source | non | idem, sous drapeau |
| Explications « ? » | Tâche existante `explain-proposals`, inchangée : elle complète toute proposition sans explication | oui | `data/explain-proposals.ts` |
| Contrôleur | Dire ce qui est en ligne, ce qui attend, ce qui est bloqué | non | `agents/controleur.ts` |

Étapes : `detecte` → `redige` → `verifie` → `en_ligne` ; `a_revoir` quand un humain doit trancher.

**Deux filières.** Les sites déjà relevés chaque semaine par `sync-candidate-proposals`
(Lisnard, Retailleau, Batho) restent à cette tâche : le veilleur constate, le rédacteur n'y
touche pas. La filière « agents » couvre ce que personne ne relevait : aujourd'hui les plans
thématiques et d'investissement de Jean-Luc Mélenchon, qui paraissent un par un.

**Ajouter un candidat** : une ligne dans la carte `SITES` de `programmes-veilleur.ts`, avec
l'adresse de la page d'index de son programme. Pour les candidats sans page connue, seul le
signal de presse joue : il demande un regard humain, il ne déclenche aucune rédaction.

**Publication automatique** (par défaut depuis le 29/10/2026) : le workflow vaut
`PROGRAMMES_PUBLICATION_AUTO=1` sauf si la variable de dépôt GitHub du même nom vaut `0` ; dans
ce cas, le contrôleur liste les brouillons vérifiés dans son rapport sans les publier.

**Site qui refuse les serveurs de GitHub** (melenchon2027.fr depuis la mi-octobre 2026, HTTP 403
alors que son robots.txt autorise tous les robots) : `src/lib/lecture-officielle.ts` lit alors
la page par l'outil web_fetch de l'API Claude (secret `ANTHROPIC_API_KEY`, ~1 centime la page).
Si même cette voie échoue, le veilleur inscrit `index:<adresse>` à l'étape « a_revoir » et le
contrôleur alerte : le veilleur n'est plus jamais aveugle en silence. Un refus se retente
20 fois (dix jours) au lieu de 4.

## Cycle « auditions »

Les agents de collecte et d'analyse sont **les tâches existantes, inchangées**. Le cycle leur
ajoute ce qui manquait : une liste de référence et un contrôle.

| Agent | Tâche unique | Fichier |
|---|---|---|
| Veilleur | Tenir la liste de toutes les réunions de commission tenues (agenda open data de l'Assemblée) et l'état de chacune | `agents/auditions-veilleur.ts` |
| Collecteur | Lire le compte rendu écrit, résumé court | `data/sync-commission-reports.ts` (existant) |
| Transcripteur | Transcrire la vidéo quand il n'y a pas de compte rendu écrit | `transcribe-auditions.ts`, dépôt du site (existant, **jamais activé**) |
| Analyste | Analyse détaillée lue par l'abonné Pro | `update-commissions.ts`, dépôt du site (existant) |
| Contrôleur | Signaler toute réunion dont le compte rendu existe et n'est pas en ligne | `agents/controleur.ts` |

Étapes : `detecte` → `collecte` → `en_ligne` ; `a_transcrire` (vidéo seule) ; `sans_source`.

État au 11 octobre 2026, sur cinq mois : 394 réunions publiables, 366 en ligne (93 %),
6 comptes rendus récents en attente de collecte, 22 réunions filmées sans compte rendu écrit.

## Ce qui reste à faire

1. **Transcription des auditions sans compte rendu écrit.** Il manque une clé de
   transcription (secret `ASR_API_KEY`, gratuite chez Groq) et la recherche de la vidéo
   d'une réunion à partir de son identifiant d'agenda. Le journal liste déjà les réunions
   concernées (étape `a_transcrire`).
2. **Sénat.** Le veilleur ne couvre que l'Assemblée. Les comptes rendus du Sénat partent déjà
   des pages d'index officielles, donc le risque d'oubli y est plus faible.
3. **Étendre la carte `SITES`** à mesure que les candidats ouvrent une page programme.
4. **Un modèle par agent.** Le rédacteur passe aujourd'hui par le client commun (modèle
   gratuit, DeepSeek en secours si autorisé). Lui attribuer un modèle propre se fera dans la
   passerelle unique prévue par l'audit (phase 1).

## Lancer à la main

```
npx tsx src/scripts/agents/programmes-veilleur.ts --dry-run
npx tsx src/scripts/agents/programmes-redacteur.ts --url=https://…   # essai, rien n'est écrit
npx tsx src/scripts/agents/controleur.ts --sans-alerte
```

---

# Banc d'essai multi-agents — 12 au 18 octobre 2026

Demande de l'éditeur : avant de généraliser, tester une semaine, sur toutes les fonctionnalités
qui s'y prêtent, ce qu'apporte une chaîne de plusieurs agents aux rôles précis.

**Méthode.** Le site continue d'être produit comme d'habitude. Des agents passent derrière
chaque texte publié et notent, dans le journal `cycle_items` (cycles `banc:<famille>`), ce
qu'ils auraient arrêté. Rien n'est corrigé ni dépublié : c'est une mesure.

| Agent | Rôle | IA | Fichier |
|---|---|---|---|
| Sentinelle | La fonctionnalité produit-elle encore ? (âge de la dernière production) | non | `agents/controleur.ts` |
| Vérificateur | Nombres et noms propres du texte publié absents de sa source | non | `agents/banc-verificateur.ts` |
| Relecteur | Un modèle d'une autre maison (gpt-oss d'OpenAI, servi par Groq) juge fidélité, neutralité, clarté | oui | `agents/banc-relecteur.ts` |
| Contrôleur | Tableau par fonctionnalité, exemples, textes signalés par les deux agents | non | `agents/controleur.ts` |

**Familles dans le banc** (`src/lib/banc.ts`) : analyses des commissions, fil d'actualité de
l'accueil, fils des ministères/collectivités/communes/partis, actualités des candidats,
résumés de l'Élysée, « Ce texte vous concerne », veille des controverses.

**Hors banc, faute de source relisible** : résumés des lois et des dossiers (la base ne garde
que l'adresse du dossier), décrets et Journal officiel (Légifrance fermé aux machines),
résumés des vidéos (transcription non conservée), explications des scrutins.

**Premier constat (11/10).** Trois fils — entités, candidats, controverses — n'enregistrent
comme source qu'un lien de redirection Google Actualités : aucun agent ne peut y relire
l'article. Une chaîne à plusieurs agents y demanderait d'abord un agent collecteur qui garde
l'adresse réelle et l'extrait dont le résumé est tiré.

**Lecture du résultat.** La colonne « signalés par les deux » compte les textes désignés à la
fois par le vérificateur (sans IA) et par le relecteur (autre modèle), sans concertation.
C'est elle qui dit où une chaîne d'agents aurait évité une erreur publiée. Bilan à tirer le
19 octobre, fonctionnalité par fonctionnalité.

**Limites.** Le relecteur est limité à une demande par minute et ne lit que des extraits des
sources longues : ses « infidèle » sont des pistes à vérifier, pas des verdicts. Secret requis
dans GitHub : `GROQ_API_KEY` (dépôt des mises à jour).

# Auditions : Sénat et transcription (11/10/2026)

- `agents/auditions-veilleur-senat.ts` : suit chaque page hebdomadaire des huit commissions
  permanentes et compare le nombre de réunions publiées au nombre en base. Attrape les pages
  que le Sénat complète après leur première collecte.
- Transcription (`transcribe-auditions.ts`, dépôt du site) : lit désormais l'étape
  `a_transcrire` du journal, retrouve la vidéo sur videos.assemblee-nationale.fr (même jour +
  nom de famille ou sigle de l'intitulé, une seule candidate, vidéo non partagée par deux
  réunions), transcrit (Whisper via Groq), analyse, publie et marque la réunion en ligne.
  Secret requis : `ASR_API_KEY` (dépôt du site).
