# Procédure de Déploiement — Tâches Planifiées & Monitoring

Ce document détaille les étapes indispensables pour configurer, déployer et valider la nouvelle architecture de crons et de monitoring en production sur Railway.

---

## Section 1 — Avant le premier déploiement

Avant de pusher le code en production, vous devez créer et configurer les différents services tiers requis :

### 1. Créer le projet Sentry
- Créez un nouveau projet de type **Node.js (Express)** sur [Sentry](https://sentry.io).
- Récupérez son **DSN** de production dans les paramètres du projet (*Project Settings > Client Keys (DSN)*).
- Ce DSN doit obligatoirement pointer vers un vrai projet Sentry créé sur Sentry.io. Si cette variable est manquante ou fictive, les erreurs survenues en production seront perdues silencieusement.

### 2. Créer les checks Healthchecks.io
Rendez-vous sur [Healthchecks.io](https://healthchecks.io) et créez individuellement les checks suivants avec leur période d'attente (Period + Grace Time) respective pour éviter les fausses alertes tout en assurant une alerte rapide en cas de plantage :
- **votes** (pour `fetch-votes`) : Période = `1 hour`, Grace = `5 minutes` (Alerte si aucun ping après **65 min**)
- **petitions** (pour `fetch-petitions`) : Période = `6 hours`, Grace = `10 minutes` (Alerte si aucun ping après **6h10**)
- **live-laws** (pour `fetch-live-laws`) : Période = `2 hours`, Grace = `10 minutes` (Alerte si aucun ping après **2h10**)
- **laws** (pour `fetch-laws`) : Période = `24 hours`, Grace = `1 hour` (Alerte si aucun ping après **25h**)
- **browseract** (pour `browseract-scraper`) : Période = `2 hours` (ou à ajuster selon la fréquence d'appel, en complément)

*Note : Récupérez l'UUID unique de chaque check à la fin de son URL de ping (ex: pour `https://hc-ping.com/1234abcd-56ef-78gh-90ij-klmnopqrstuv`, l'UUID est `1234abcd-56ef-78gh-90ij-klmnopqrstuv`).*

### 3. Créer le projet Inngest
- Connectez-vous sur [Inngest](https://inngest.com) et créez une nouvelle application ou projet.
- Récupérez la clé de signature de l'application : `INNGEST_SIGNING_KEY` (dans *Settings > Signing Keys*).
- Récupérez la clé d'événement : `INNGEST_EVENT_KEY` (dans *Settings > Event Keys*).

### 4. Désactiver les anciens workflows GitHub Actions
- Désactivez ou supprimez les anciens déclencheurs de crons GitHub Actions (fichiers dans `.github/workflows/`).
- **Important** : Comme Inngest gère désormais l'intégralité de la planification des crons, laisser les anciennes GitHub Actions actives entraînerait des exécutions en parallèle en doublon (gaspillage de requêtes Anthropic, multiples écritures Supabase). Vous devez archiver ces fichiers ou en retirer les déclencheurs de type `schedule`.

---

## Section 2 — Variables à ajouter dans le dashboard Railway

Ajoutez manuellement les variables d'environnement ci-dessous dans l'interface de votre service sur Railway (*Variables > New Variable*).

Vous pouvez directement copier-coller le bloc complet suivant :

```env
# AUTOMATION & MONITORING
INNGEST_SIGNING_KEY=        # Clé de signature Inngest (dashboard inngest.com)
INNGEST_EVENT_KEY=          # Clé d'événement Inngest
SENTRY_DSN=                 # DSN du projet Sentry (sentry.io > Project > Settings > SDK Setup)
HEALTHCHECK_ID_VOTES=       # UUID du check Healthchecks.io pour fetch-votes
HEALTHCHECK_ID_PETITIONS=   # UUID du check Healthchecks.io pour fetch-petitions
HEALTHCHECK_ID_LIVE_LAWS=   # UUID du check Healthchecks.io pour fetch-live-laws
HEALTHCHECK_ID_LAWS=        # UUID du check Healthchecks.io pour fetch-laws
HEALTHCHECK_ID_BROWSERACT=  # UUID du check Healthchecks.io pour browseract-scraper
ANTHROPIC_MAX_RETRIES=3
ANTHROPIC_REQUESTS_PER_MINUTE=50
```

> [!WARNING]  
> Sans ces variables, les scripts tourneront mais sans monitoring — les échecs seront silencieux.

---

## Section 3 — Vérification post-déploiement

Une fois le code déployé sur Railway avec les variables d'environnement correctement configurées, valisez manuellement les 5 points suivants :

1. **L'endpoint `/api/inngest` répond 200** :
   Effectuez une requête GET sur `https://votre-backend-railway.railway.app/api/inngest` depuis votre navigateur ou via `curl`. L'endpoint doit renvoyer un code HTTP `200` (contenant la configuration JSON de vos fonctions Inngest).

2. **Un ping Healthchecks.io apparaît dans le dashboard** :
   Déclenchez manuellement une exécution d'un script (par exemple via Inngest ou via une commande locale pointant sur la base de prod) et vérifiez sur le tableau de bord de Healthchecks.io que le dernier statut du check passe au vert avec la mention *"Just Now"*.

3. **Une erreur de test remonte dans Sentry** :
   Ajoutez temporairement une route Express dédiée `/api/test-sentry` appelant `Sentry.captureException(new Error('test-prod'))` pour déclencher une erreur volontaire en production. Vérifiez que cette erreur remonte instantanément dans le dashboard Sentry, puis supprimez cette route dédiée immédiatement après validation.

4. **Les fonctions Inngest apparaissent dans la console Inngest** :
   Connectez-vous à la console Inngest Cloud. Sous votre application, vérifiez que les fonctions suivantes sont détectées et listées :
   - `fetch-votes`
   - `fetch-petitions`
   - `fetch-live-laws`
   - `scrutin-summarizer`

5. **Les crons sont bien planifiés** :
   Dans la console Inngest Cloud, accédez à l'onglet *Crons* ou *Schedules* et confirmez que la planification et l'heure de déclenchement prévue de chaque tâche automatisée correspondent bien aux fréquences attendues (toutes les heures pour les votes, toutes les 6 heures pour les pétitions, toutes les 2 heures pour les live laws, etc.).
