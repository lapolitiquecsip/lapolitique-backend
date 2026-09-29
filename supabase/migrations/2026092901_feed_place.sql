-- ─────────────────────────────────────────────────────────────────────────────
-- Le lieu d'une actualité locale, et d'une alerte.
--
-- Une alerte disait « La municipalité acte la démolition de l'église communale »
-- sans que le lecteur puisse savoir de quelle ville il s'agissait. Deux causes :
--   — le fil d'un DÉPARTEMENT ramasse aussi des articles sur UNE commune (« Dans
--     cette commune de Loire-Atlantique, les élus… »), et le titre réécrit par
--     l'IA perdait ce qui restait du lieu ;
--   — la carte d'alerte n'affichait aucun lieu, pas même le département.
--
-- `place`       : le lieu à afficher — la commune quand l'article en concerne
--                 une, sinon le département ou la région du fil.
-- `place_scope` : 'commune' si l'article ne concerne qu'une commune, 'territoire'
--                 s'il vaut pour tout le département ou toute la région. Une
--                 actualité d'une seule commune n'est poussée qu'aux habitants de
--                 cette commune : c'est la règle « géo strict » de MES ALERTES.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.entity_feed
  add column if not exists place text,
  add column if not exists place_scope text
    check (place_scope is null or place_scope in ('commune', 'territoire'));

alter table public.user_notifications
  add column if not exists place text;
