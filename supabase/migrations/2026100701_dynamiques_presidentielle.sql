-- ─────────────────────────────────────────────────────────────────────────────
-- Présidentielle 2027, onglet « Dynamiques » : sondages, veille presse, temps de
-- parole Arcom. Trois sources, trois tables, toutes alimentées par des crons.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) SONDAGES — un enregistrement par hypothèse testée dans un sondage.
--    Source : la liste des sondages tenue sur Wikipédia (institut, dates,
--    échantillon, scores), mise à jour dans les heures qui suivent chaque
--    publication. resultats = [{nom, slug, pct}] ; slug null pour une
--    personnalité qui n'a pas de fiche candidat.
create table if not exists public.sondages (
  id          bigserial primary key,
  cle         text not null unique,      -- institut|fin|tour|hypothèse : identité stable
  tour        smallint not null check (tour in (1, 2)),
  institut    text not null,
  date_debut  date,
  date_fin    date not null,
  echantillon integer,
  hypothese   smallint not null default 1,
  resultats   jsonb not null,
  source_url  text,
  notifie     boolean not null default false,  -- alerte « nouveau sondage » déjà envoyée
  cree_le     timestamptz not null default now(),
  maj_le      timestamptz not null default now()
);
create index if not exists sondages_date on public.sondages (tour, date_fin desc);
alter table public.sondages enable row level security;
drop policy if exists "sondages lisibles" on public.sondages;
create policy "sondages lisibles" on public.sondages for select using (true);

-- 2) VEILLE PRESSE — chaque article d'un panel fixe de médias qui nomme un
--    candidat. Le panel est relu toutes les deux heures ; compter des articles
--    identifiés (et non des estimations) rend chaque chiffre vérifiable.
create table if not exists public.media_articles (
  url        text primary key,
  titre      text not null,
  media      text not null,
  publie_le  timestamptz not null,
  candidats  text[] not null,           -- slugs des candidats nommés
  cree_le    timestamptz not null default now()
);
create index if not exists media_articles_date on public.media_articles (publie_le desc);
create index if not exists media_articles_candidats on public.media_articles using gin (candidats);
alter table public.media_articles enable row level security;
drop policy if exists "articles lisibles" on public.media_articles;
create policy "articles lisibles" on public.media_articles for select using (true);

-- 3) TEMPS DE PAROLE ARCOM — par candidat et par mois, toutes chaînes et
--    radios confondues (detail = secondes par antenne). Chiffres officiels,
--    publiés par l'Arcom avec environ deux mois de décalage.
create table if not exists public.arcom_temps_parole (
  slug       text not null,
  mois       date not null,               -- premier jour du mois
  secondes   integer not null,
  detail     jsonb not null default '{}',
  source     text,
  maj_le     timestamptz not null default now(),
  primary key (slug, mois)
);
alter table public.arcom_temps_parole enable row level security;
drop policy if exists "temps de parole lisible" on public.arcom_temps_parole;
create policy "temps de parole lisible" on public.arcom_temps_parole for select using (true);

-- Agrégats de la veille presse, calculés en base : la page reçoit quelques
-- centaines de lignes au lieu de milliers d'articles.
create or replace function public.veille_presse(p_jours integer default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  with a as (
    select url, titre, media, publie_le, unnest(candidats) as slug
    from media_articles
    where publie_le > now() - make_interval(days => p_jours * 2)
  ),
  cur as (select * from a where publie_le > now() - make_interval(days => p_jours)),
  prev as (select * from a where publie_le <= now() - make_interval(days => p_jours))
  select jsonb_build_object(
    -- Début de la mesure : la première relève (les flux portent aussi quelques
    -- articles plus anciens, qui ne disent rien des jours précédents).
    'depuis', (select min(cree_le) from media_articles),
    'medias', (select count(distinct media) from media_articles where publie_le > now() - make_interval(days => p_jours)),
    'articles', (select count(*) from media_articles where publie_le > now() - make_interval(days => p_jours)),
    'totaux', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select c.slug, count(*) n, count(distinct c.media) nb_medias,
               (select count(*) from prev p where p.slug = c.slug) n_prec
        from cur c group by c.slug) x),
    'par_jour', (select coalesce(jsonb_agg(x order by x.jour), '[]') from (
        select slug, (publie_le at time zone 'Europe/Paris')::date jour, count(*) n
        from cur group by 1, 2) x),
    'par_media', (select coalesce(jsonb_agg(x), '[]') from (
        select slug, media, count(*) n from cur group by 1, 2) x),
    'derniers', (select coalesce(jsonb_agg(x order by x.publie_le desc), '[]') from (
        select url, titre, media, publie_le, candidats from media_articles
        where publie_le > now() - make_interval(days => p_jours)
        order by publie_le desc limit 60) x)
  );
$$;
grant execute on function public.veille_presse(integer) to anon, authenticated;
