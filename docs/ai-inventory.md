# Inventaire IA — état réel du code

Établi le 7 octobre 2026 (phase 0 de l'audit IA), à partir du code des deux dépôts :

- **mises à jour** : `lapolitiquecsip/lapolitique-backend` (scripts GitHub Actions, serveur Railway, un script Python) ;
- **site** : `lapolitiquecsip/politique-pour-tous` (Next.js en export statique, scripts GitHub Actions, fonctions Edge Supabase).

Heures en UTC. Lignes de code données sur la branche `ia/phase-0` de chaque dépôt.

---

## 1. Correction d'une information donnée auparavant

Le rapport précédent disait que le Journal officiel et les commissions « basculent automatiquement sur DeepSeek v4-pro quand le quota gratuit est épuisé ». **C'est faux.**

Dans `scripts/lib/llm.ts`, DeepSeek n'est appelé **que si aucune clé gratuite n'est configurée**. Les deux workflows ont la clé gratuite, donc quand Gemini est saturé, l'appel échoue et le texte paraît sans explication (intitulé officiel seul).

Le risque était **latent** : si le secret `LLM_FREE_API_KEY` disparaissait ou expirait, tout le volume partait sur v4-pro, le modèle le plus cher, sans alerte. Le correctif 0.2a ferme cette porte.

---

## 2. Fournisseurs et clients

### Fournisseurs appelés

| Fournisseur | Appelé par | Paiement |
|---|---|---|
| Google Gemini (AI Studio, palier gratuit) | les 3 clients ci-dessous + transcription vidéo | gratuit, quota par lignée de modèle, remis à zéro à minuit heure du Pacifique |
| DeepSeek (`deepseek-v4-flash`, `deepseek-v4-pro`) | client des mises à jour (si `payant`), client du site (si pas de clé gratuite), **script Python en direct** | prépayé, solde 5,88 $ le 07/10 |
| Anthropic Claude (`claude-sonnet-5`) | secours du fil d'accueil (site) ; scripts de test | carte, à la consommation |
| Tavily (recherche web) | `presidential-candidates.ts`, `candidate-positions.ts`, `assess-program-grounded.ts` | crédits Tavily |
| Groq (transcription audio) | `transcribe-auditions.ts` | jamais configuré (pas de clé) |
| yt-dlp (sous-titres YouTube) | `src/lib/transcription.ts` | gratuit, sans IA |

### Les trois clients IA, et les appels qui n'en utilisent aucun

| | Client des mises à jour | Client du site | « Tout sur un sujet » |
|---|---|---|---|
| Fichier | `src/lib/deepseek-client.ts` (dépôt mises à jour) | `scripts/lib/llm.ts` (dépôt site) | `supabase/functions/topic-brief/index.ts` |
| Exécution | Node (tsx) dans GitHub Actions | Node (tsx) dans GitHub Actions | Deno, fonction Edge Supabase |
| Interface | `resilientDeepSeek.createMessage(params, {timeoutMs, payant})`, format messages OpenAI | `demanderJSON(systeme, utilisateur, {maxJetons, essais})`, JSON seulement | `demander(systeme, utilisateur)` interne |
| Protocole | SDK `openai` (endpoint compatible OpenAI de Gemini et de DeepSeek) | `fetch` natif Gemini `generateContent` ; `fetch` DeepSeek | `fetch` natif Gemini |
| Ordre gratuit | gemini-3.6-flash → 3.5-flash → 3.1-flash-lite → flash-latest → flash-lite-latest | 3.6-flash → 3.5-flash → 3.7-flash → 3.8-flash → 3.1-flash-lite → flash-latest | liste `LLM_FREE_MODELS` |
| Payant | DeepSeek si `payant: true` ; secours auto si `LLM_SECOURS_PAYANT=1` (absent) | DeepSeek seulement sans clé gratuite ; secours si `LLM_SECOURS_PAYANT=1` (ajouté en 0.2a, éteint) | aucun |
| Réflexion (« thinking ») | coupée seulement si `sansReflexion` (DeepSeek) | coupée (`thinkingBudget: 0` ; DeepSeek ajouté en 0.2a) | essayée avec, puis sans si 400 |
| Contrôle de sortie | rejet des caractères non latins (3 essais) | JSON valide, cause d'arrêt lue | renvois de sources vérifiés un par un |
| Jetons mesurés | lus et affichés dans les logs, **jamais enregistrés** | non lus (Gemini) | non lus |
| Plafond de dépense | lecture du solde DeepSeek seulement | aucun | aucun |

**Appels directs, hors de tout client :**

- `python/positions_web.py` : DeepSeek `deepseek-v4-flash` **payant**, chaque jour, sans passage par le gratuit.
- `src/lib/transcription.ts` : Gemini `file_data`.
- Les appels Tavily.
- `contentScrapingService.ts` : SDK Anthropic.
- `src/scripts/automation/test-anthropic.ts` et `src/scripts/test_anthropic.ts`.

---

## 3. Inventaire appel par appel

Conventions :

- **G** = cascade Gemini gratuite du client.
- **G→DS** = Gemini, puis DeepSeek payant en secours décidé par le script (`payant: true` au second essai).
- **DS** = DeepSeek payant directement.
- Le modèle écrit dans le code (`deepseek-chat`) est ignoré sur le gratuit. Sur DeepSeek, c'est un alias retiré qui coûtait une erreur 4xx avant de retomber sur flash ; depuis 0.2a, il va directement à flash.
- « Prompt » : l'emplacement de la consigne. Elle est presque toujours écrite dans l'appel lui-même.

### 3.1 Lois, Parlement, Journal officiel

| Tâche | Fichier → fonction (ligne de l'appel) | Déclencheur | Modèle | Sortie → table |
|---|---|---|---|---|
| Résumés des lois | `automation/law-summarizer.ts` → `summarizeLaws` (L66) | `bulk-summarize` 21:10 | G (le script essaie « flash puis pro », ignoré sur le gratuit ; v4-pro désormais refusé) | JSON `summary, content, category` → `laws` |
| Résumé et analyse des dossiers législatifs | `legislative/summarize.ts` → `summarizeLegislativeDossiers` (L109) | `legislative-analysis` 00:17 et 17:17→23:17, 2 passages | G | JSON → `legislative_analyses` |
| Analyse approfondie (PDF AN) | `legislative/analyse-approfondie.ts` → `demanderJson` (L215), prompt `systeme` | `legislative-analysis` `--max=3` ; campagne payante `analyses-approfondies-campagne` (cron défini, **aucun passage** à ce jour) | G ; DS flash si `--payant`, avec coût réel enregistré | JSON → `dossier_analyses_approfondies` (`cout_usd`) |
| Scrutins du Sénat | `legislative/summarize-scrutins.ts` → `explain` (L15) | `legislative-sync` toutes les heures | G | texte → `legislative_scrutins` |
| Scrutins de l'Assemblée | `automation/scrutin-summarizer.ts` → `summarizeScrutins` (L44) | `votes-sync` 22:20 | G | texte → `scrutins` |
| Comptes rendus de commission (résumé) | `data/sync-commission-reports.ts` → `summarize` (L51) | `legislative-sync` toutes les heures, `--limit=25` | G | texte → `commission_reports.summary` |
| Analyses des commissions | site `scripts/update-commissions.ts` → `analyseOne` (L349), prompt `SYSTEM` + `SHAPE` (`scripts/lib/commission-prompt.ts`) | `update-commissions` 07:30, 10:00, 13:00, 16:00 | G (secours flash si drapeau) | JSON → `commission_reports.analysis` ; **citations vérifiées mot pour mot** (`dropInventedQuotes`) |
| Titres courts des dossiers | `data/sync-dossier-titles.ts` → `shorten` (L50) | `legislative-sync` toutes les heures | G | texte → `dossier_display_title` |
| Impact citoyen | `data/sync-law-citizen-impact.ts` → `impactOf` (L32) | `legislative-sync` toutes les heures | G | texte → `law_citizen_impact` |
| Votes du jour par enjeu | `data/tag-scrutins-issues.ts` → `llmTags` (L65) | `votes-sync` 22:20, 2 passages (AN, Sénat) | G | JSON → `scrutin_issues` |
| Décrets : résumé | `data/summarize-decrees.ts` → `aiSummary` (L15) | `decrees-sync` 23:40 | G | texte → `decrees` |
| Décrets : titre | `data/sync-decree-titles.ts` → `aiTitle` (L35) | `decrees-sync` 23:40 | G | texte → `decrees` |
| Journal officiel du jour (résumé + explication par texte) | site `scripts/update-jorf.ts` → `resumer` (L349) et explications par lots (L478, L808) | `update-jorf` 01:45 et 22:30 | G (secours flash si drapeau) ; échec → intitulé officiel seul | JSON → `jorf_editions` (`digest`, explications dans le sommaire, `source_explication = 'ia'`) et `jorf_texts` |
| Affaires judiciaires | `explain-legal.ts` → `explainAffair` (L61), prompt `EXPLAIN_SYSTEM` | `legal-sync` 22:15 | G | texte → `legal_case_explanations` |
| **Résumé quotidien du Sénat** *(absent de la liste)* | `automation/summarize-daily-senat.ts` → `main` (L50) | `agendas-sync` 17:23, 20:23, 23:23 | G | texte → `events` (hash sha1 de l'entrée) |

### 3.2 Élus et institutions

| Tâche | Fichier → fonction (ligne) | Déclencheur | Modèle | Sortie → table |
|---|---|---|---|---|
| Bios des députés | `data/sync-elected-bios-structured.ts deputies` → `structureBio` (L83) | `votes-sync` 22:20, `--limit=300` | G (DS si `--payant`, manuel) | JSON → `deputies.bio` (`_v` = version) |
| Bios des sénateurs | même script, `senators` | `senator-bios-sync` 07:10, `--limit=80` | G (DS si `--payant`, manuel) | JSON → `senators.bio` |
| Bios des eurodéputés | `data/sync-mep-bios.ts` → `writeBio` (L35) et `data/sync-mep-bios-structured.ts` → `structureBio` (L37) | `europe-sync` jeudi 12:25 et le 7 du mois 12:45 | G | texte puis JSON → `meps` |
| **Explications des votes européens** *(absent de la liste)* | `data/sync-vote-explanations.ts` → `explain` (L39), `titresFr` (L85) | `europe-sync`, 2 passages | G | JSON → `vote_explanations` |
| Bios des maires (≥ 5 000 hab.) | `data/sync-mayor-bios.ts` → `lib/bio-pipeline.ts` `structureBio` (L53) | `mayors-sync` le 7 du mois 13:10 | G | JSON → `mayors` |
| Bios des présidents de département | `data/sync-department-president-bios.ts` → `structureBio` (L57) | `department-presidents-sync` le 6 du mois 12:50 | G | JSON → `department_presidents` |
| Bios des ministres | `data/sync-ministers.ts` → `structureBio` (L39) | `ministers-sync` 22:45 | G | JSON → `minister_profiles` |
| Fiches des partis | `enrich-parties.ts` → `structure` (L101) | `parties-sync` 22:25 | G | JSON → `political_parties` |
| Histoire électorale des partis | `party-history.ts` → `electionSeries` (L85) | `parties-sync` 22:25 | G | JSON → `party_history` |
| Élysée : résumés | `data/summarize-elysee.ts` → `summarize` (L25) | `elysee-sync` 04:15 | G | texte → `elysee_publications.summary` |
| Élysée : programme du Président | `data/sync-president-program.ts` → `extractEngagements` (L66, L96), `assess` (L129) | `elysee-sync` 04:15 | G | texte → `presidential_program` (**contient une évaluation**) |
| Élysée : évaluation du programme | `data/assess-program-grounded.ts` → `wikiQuery` (L195), `assessWithEvidence` (L240), `assessFromKnowledge` (L305) + Tavily | `elysee-sync` 04:15 | G + Tavily | texte → `presidential_program` (**jugement ; « d'après ses connaissances » sans source**) |
| Positions des élus (questions écrites) | `data/sync-deputy-positions-questions.ts` (L124), `data/sync-senator-positions-questions.ts` (L101) | `positions-sync` dimanche 23:40 | G | JSON → `entity_positions` |
| Positions des élus (amendements) | `data/sync-deputy-positions-amendments.ts` (L114) | `positions-sync` dimanche 23:40 | G | JSON → `entity_positions` |
| Stats de la semaine | `automation/generate-weekly-stats.ts` → `generateWeeklyStats` (L63) | `weekly-stats` lundi 22:00 | G | JSON → `events`. **Aucune donnée fournie** : le modèle écrit 5 « informations marquantes » et une « intox » de mémoire, sans source. |

### 3.3 Fils d'actualité

| Tâche | Fichier → fonction (ligne) | Déclencheur | Modèle | Sortie → table |
|---|---|---|---|---|
| Fil ministères, départements, régions | `automation/sync-institution-news.ts` → `summarise` (L156), prompt `promptFor` | `institution-news` 18:13 | G ; arrêt si quota épuisé | JSON → `entity_feed` |
| Fil des communes | même script | `commune-news` 07:20 | G | JSON → `entity_feed` |
| Fil des partis | même script | `fil-partis` 08:20, 13:20, 18:20 + alarme 48 h | G→DS→titre brut | JSON → `entity_feed` |
| Fil de l'accueil (site) | site `src/lib/services/contentScrapingService.ts` → `processWithClaude` (lots de 40) | `update-content` 07:40, 11:10, 15:10 | G → (avant 0.2b) Claude Sonnet | JSON → `content` |
| **Fil de l'accueil, 2ᵉ ingestion** *(absent de la liste)* | `workers/assemblee-pipeline.ts` → `summarise` (L155), via `automation/content-pipeline.ts` | `content-sync` 09:23, 13:23, 17:23 | G | texte → `content` (même table) |
| Titres de l'agenda | site `scripts/update-event-titles.ts` (L104) | `update-event-titles` 05:20, 11:20, 16:20 | G | JSON → `events` |
| Veille des controverses | `automation/veille-controverses.ts` → `juger` (L143), prompt `CONSIGNE` | `veille-controverses` 07:15 puis toutes les 3 h de 10:15 à 22:15 | G | JSON → `controverses_veille` |

### 3.4 Présidentielle

| Tâche | Fichier → fonction (ligne) | Déclencheur | Modèle | Sortie → table |
|---|---|---|---|---|
| Fiches des candidats | `automation/presidential-candidates.ts` → `detectCandidates` (L118), `structureBio` (L179), `webStrongPositions` (L267) + Tavily | `presidentielles-sync` 08:35 | G + Tavily | JSON → `presidential_candidates` |
| Actus des candidats | `automation/presidential-news.ts` → `summariseNews` (L11) | `presidentielles-sync` 08:35 | G ; articles bruts si quota épuisé | JSON → `candidate_news` |
| Programmes (sites) | `data/sync-candidate-proposals.ts` → `extractIdeas` (L64), prompt `SYS` | `presidentielles-sync` 08:35 | G | JSON → `candidate_proposals` |
| Programmes (vidéos) | `data/programmes-videos.ts` → `json` (L41) ; transcription yt-dlp, sinon Gemini `file_data` | `programmes-candidats` toutes les 3 h | G→DS | JSON → `candidate_proposals`, `programmes_sources` ; contrôle des chiffres présents dans la transcription |
| Explications « ? » | `data/explain-proposals.ts` → `explainOne` (L72), prompt `SYS` | `presidentielles-sync` 08:35 (G) ; `programmes-candidats` toutes les 3 h (`--payant` = DS) | G / DS | texte → `candidate_proposals` |
| Positions des candidats (Tavily) | `automation/candidate-positions.ts` → `extractPositionsWeb` (L67), `extractPositions` (L90) | `presidentielles-sync` 08:35 | G + Tavily | JSON → `candidate_positions`, `issues` |
| **Positions des candidats (votes)** *(absent de la liste)* | `automation/candidate-positions-votes.ts` (L94) | `presidentielles-sync` 08:35 | G | JSON → `candidate_positions` |
| **Positions des candidats (Python)** *(absent de la liste)* | `python/positions_web.py` → `extract_positions` | `positions-web` 22:05, chaque jour | **DS direct, payant** ; source = comparateur tiers `elyseescope.com` | JSON → `candidate_positions` |
| Résumés vidéos et débats | `data/resumer-videos.ts` → `resumer` (L42), prompt `SYS` ; transcription comme ci-dessus | `programmes-candidats` toutes les 3 h | G→DS | JSON → `candidate_videos.resume_ia`, `candidate_debates.resume_ia` |

### 3.5 Abonnés Pro

| Tâche | Fichier → fonction (ligne) | Déclencheur | Modèle | Sortie → table |
|---|---|---|---|---|
| « Ce texte vous concerne » | `automation/alertes-textes.ts` → `analyser` (L100–101) ; rapprochement texte ↔ profil **par règles, sans IA** | `alertes-pro` toutes les heures à :15 | G→DS (un appel par texte, pas par abonné) | texte → `textes_impacts`, puis `user_notifications` |
| Tri des actus suivies | `automation/generate-suivis-notifications.ts` → `trier` (L88), prompt `GRILLE` ; cache `tri_suivis` | `alertes-pro` toutes les heures | G→DS→règles | JSON → `tri_suivis`, `user_notifications` |
| Édito du récap (rédaction + relecture) | `automation/recap-hebdo.ts` → `appel` (L132–133) | `alertes-pro` vendredi 16:00 (relecture), samedi 06:00 et 07:00 | G→DS | texte → `recap_editos` |
| « Tout sur un sujet » | site `topic-brief/index.ts` → `demander` (L112) | à la demande d'un abonné Pro | G seulement | JSON → `topic_briefs` (cache par sujet, empreinte des sources) |

### 3.6 Serveur Railway (dépôt des mises à jour)

- `src/index.ts` : les workers horaires sont **désactivés**. Le serveur ne déclenche donc aucun appel IA de lui-même.
- La route `POST /api/admin/run-pipeline?name=assemblee` lance `assemblee-pipeline` (appels IA). **Aucune authentification.**
- Les fonctions Inngest (`src/lib/inngest.ts`) se déclenchent sur événement, pas sur horaire.
- Le site ne référence aucune URL Railway.
- Je n'ai pas pu vérifier si le service est encore déployé.

---

## 4. Correspondance avec la liste de tâches déclarée

| Tâche déclarée | Trouvée dans le code |
|---|---|
| résumés des lois | ✅ `law-summarizer.ts` |
| dossiers législatifs | ✅ `legislative/summarize.ts` |
| analyse approfondie (PDF) | ✅ `analyse-approfondie.ts` |
| scrutins | ✅ deux scripts : Sénat et Assemblée |
| comptes rendus de commission | ✅ `sync-commission-reports.ts` (résumé, mises à jour) |
| titres courts | ✅ `sync-dossier-titles.ts` |
| impact citoyen | ✅ `sync-law-citizen-impact.ts` |
| votes du jour par enjeu | ✅ `tag-scrutins-issues.ts` |
| décrets | ✅ deux scripts : résumé, titre |
| Journal officiel du jour | ✅ site `update-jorf.ts` |
| analyses des commissions | ✅ site `update-commissions.ts` (même table que les comptes rendus : fusion naturelle) |
| affaires judiciaires | ✅ `explain-legal.ts` |
| biographies | ✅ 6 scripts ; maires via `bio-pipeline` |
| fiches des partis | ✅ `enrich-parties.ts` + `party-history.ts` |
| Élysée (résumés, programme, évaluation) | ✅ 3 scripts |
| positions des élus | ✅ 3 scripts |
| stats de la semaine | ⚠️ `generate-weekly-stats.ts` : ce ne sont **pas des statistiques**. Le modèle produit des « faits institutionnels » et une « intox » **de mémoire, sans aucune source ni requête SQL** |
| fils (institutions, communes, partis, accueil) | ✅ ; l'accueil a **deux** ingestions |
| titres de l'agenda | ✅ site `update-event-titles.ts` |
| veille des controverses | ✅ |
| fiches et actus candidats | ✅ 2 scripts |
| programmes (sites, vidéos) | ✅ 2 scripts |
| explications « ? » | ✅ |
| positions des candidats (Tavily) | ✅, plus 2 voies non déclarées (votes, Python) |
| résumés vidéos/débats | ✅ |
| « Ce texte vous concerne » | ✅ |
| tri des actus suivies | ✅ |
| édito du récap | ✅ |
| « Tout sur un sujet » | ✅ |

### Dans le code mais absent de la liste

1. **Résumé quotidien du Sénat** : `summarize-daily-senat.ts`, 3 fois par jour.
2. **Deuxième ingestion du fil d'accueil** : `assemblee-pipeline.ts` via `content-sync`, 3 fois par jour, même table `content`.
3. **Explications des votes européens** et leurs titres en français : `sync-vote-explanations.ts`.
4. **Positions des candidats d'après leurs votes** : `candidate-positions-votes.ts`.
5. **Positions des candidats en Python** : `positions_web.py`. C'est la seule tâche **payante sans passer par le gratuit**, chaque jour. Elle appelle DeepSeek hors de tout client et lit un comparateur tiers (`elyseescope.com`), pas une source officielle.
6. **Transcription vidéo par Gemini** (`file_data`), en secours de yt-dlp : un service de transcription non déclaré.
7. **Recherche Tavily dans l'évaluation du programme présidentiel** (`assess-program-grounded.ts`), en plus des candidats.

### Dans la liste mais pas comme décrit

- « Fallback automatique vers v4-pro (JO, commissions) » : latent seulement (voir §1).
- « Tout sur un sujet » : aucun identifiant d'abonné n'est envoyé. Seuls le sujet tapé (3 à 80 caractères) et les documents publics trouvés partent vers Gemini. La synthèse est mise en cache par sujet, partagée entre abonnés, et n'est liée à personne.

---

## 5. Scripts IA inactifs ou ponctuels

| Script | État |
|---|---|
| site `src/lib/services/agendaScrapingService.ts` (Claude) | appelé seulement par `src/api_disabled/cron/update-agenda` : jamais exécuté |
| site `scripts/update-promulgated-laws.js` | le client IA est en commentaire ; le workflow tourne chaque jour à 04:00 **sans IA** |
| site `scripts/transcribe-auditions.ts` | le workflow tourne chaque jour à 04:30 et s'arrête aussitôt (pas de clé `ASR_API_KEY`) |
| `automation/dossier-generator.ts`, `automation/fetch-live-laws.ts` | appelés seulement par les workers Railway désactivés |
| `automation/backfill-feed-places.ts`, `automation/enrich-events.ts`, `automation/generate-law-visual.ts`, `automation/summarize-articles.ts`, `automation/summarize-specific-law.ts`, `automation/summarize-5240.ts`, `automation/fix-2743.ts` | ponctuels, lancés à la main, aucun workflow |
| `data/debate-program.ts`, `data/program-evidence.ts`, `data/regen-empty-positions.ts`, `data/fix-party-summaries-fr.ts`, `data/sync-presidents-bios.ts`, `data/sync-senator-bios.ts` (ancienne version texte), `legislative/validate-expose.ts` | ponctuels, aucun workflow |
| `compile-communes-data.ts`, `compile-departments-data.ts` | ponctuels : demandent des **indicateurs chiffrés** à l'IA (à ne plus jamais relancer, cf. principe « chiffres sans LLM ») |
| `debug_anthropic_deep.ts`, `test_anthropic.ts`, `automation/test-anthropic.ts` | tests |

Aucune suppression n'est faite (phase 8, avec accord).

---

## 6. Données d'abonnés et IA

| Flux | Ce qui part vers l'IA | Conforme au principe ? |
|---|---|---|
| « Ce texte vous concerne » | titre + résumé du texte officiel ; le profil reste en base, rapprochement par règles | oui |
| Tri des actus suivies | l'article et l'entité suivie (parti, candidat…), une fois par article, sans abonné | oui |
| Édito du récap | sources communes à tous ; relecture sur le texte de l'édito | oui |
| « Tout sur un sujet » | **le sujet tapé par l'abonné** (requête libre) → Gemini gratuit | **non** (cible phase 7). Le minimum demandé en 0.2 est déjà tenu : aucun identifiant n'est envoyé. |

Aucune liste de suivi, aucun profil et aucun identifiant n'est présent dans un prompt aujourd'hui.

---

## 7. Mentions « généré par IA » sur le site

**Déjà signalés avant la phase 0 :**

- cartes de l'accueil (« résumé IA ») ;
- dossier de loi détaillé ;
- biographies (`StructuredBio`) ;
- programme des candidats ;
- fiche candidat ;
- vidéos (« résumé IA de ce qui est dit »).

**Ajoutés en 0.2c :**

- résumé du JO du jour, et une étiquette « Explication IA » par texte ;
- analyse des commissions, avec « citations vérifiées automatiquement » parce qu'un contrôle existe ;
- résumé des commissions ;
- fenêtre des fils d'actualité (partis, ministères…) ;
- analyse approfondie des lois.

**Repérés sans mention, à traiter ensuite (liste à compléter par une passe écran par écran) :**

- explications des votes européens (`MepClient`) ;
- résumés des scrutins (`RecentVotesFeed`, `AdoptedTextsFeed`, `DossierModal`) ;
- impact citoyen ;
- explications des affaires judiciaires ;
- histoire et fiches des partis (`PartyClient`) ;
- résumés de l'Élysée, programme et évaluation (`/executif`) ;
- stats de la semaine ;
- actus des candidats ;
- titres de l'agenda ;
- résumés des décrets.

**« Vérifié automatiquement »** ne peut s'écrire honnêtement que là où un contrôle existe :

- citations des commissions ;
- chiffres des programmes vidéo ;
- citation des alertes « Ce texte vous concerne » (e-mails) ;
- renvois de « Tout sur un sujet ».

Partout ailleurs, la mention dit seulement « généré par IA à partir de [source] ».

---

## 8. Plafonds à régler côté fournisseurs

| Fournisseur | Où | Réglage conseillé |
|---|---|---|
| DeepSeek | platform.deepseek.com → Top up | Compte **prépayé** : le solde est le plafond. Recharger par petites sommes (≤ 10 $). Je n'ai pas trouvé de limite mensuelle configurable ; à vérifier dans la console. |
| Google AI Studio (Gemini) | console Google Cloud du projet de la clé `LLM_FREE_API_KEY` → Facturation | **Ne pas activer la facturation sur ce projet.** Cela ferait sortir la clé du palier gratuit, et les données ne seraient plus traitées aux conditions gratuites. Pour du Gemini payant plus tard, prendre un projet séparé avec une alerte de budget (une alerte Google Cloud prévient sans bloquer). |
| Anthropic | console.anthropic.com → Settings → Limits | Limite de dépense mensuelle basse (ex. 5 $). Après la bascule 0.2b, la clé `ANTHROPIC_API_KEY` du dépôt du site ne sert plus qu'au retour arrière : la révoquer une fois la semaine de comparaison passée. |
| Tavily | app.tavily.com → Billing | Rester sur le forfait de crédits ; ne pas activer le dépassement payant (« pay as you go »). |
| Groq | — | Inutilisé : rien à régler. |
| Mistral (cible phase 5) | console.mistral.ai → Workspace → Limits | À configurer à la création de la clé ; plafond mensuel exact à vérifier dans la console. |

---

## 9. Correctifs de la phase 0 (branches locales `ia/phase-0`, non poussées)

| Réf. | Dépôt | Commit | Drapeau / retour arrière |
|---|---|---|---|
| 0.2a | site | `115959ff` : v4-pro refusé, secours flash optionnel | `LLM_SECOURS_PAYANT` (éteint) ; `LLM_AUTORISER_PRO=1` rétablit v4-pro |
| 0.2a | mises à jour | `2662d048` : v4-pro refusé dans le client, `deepseek-chat` → flash | `LLM_AUTORISER_PRO=1` |
| 0.2b | site | `bfb01fd5` : fil d'accueil Gemini → flash (drapeau) → intitulés officiels | `FIL_ACCUEIL_SECOURS=claude` rétablit l'ancien comportement |
| 0.2c | site | `6ecfab9a` : `MentionIA` avec source, ajoutée sur 5 blocs | revert du commit |
