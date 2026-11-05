-- Débats en séance publique, cherchables (Pro) : chaque prise de parole de l'Assemblée (comptes
-- rendus intégraux Syceron, sync-debats-an.ts), indexée pour la recherche plein texte en français,
-- sans accents (« energie » trouve « énergie »).

-- unaccent n'est pas « immutable » : une enveloppe l'est, pour pouvoir indexer.
create or replace function public.sans_accents(t text) returns text
  language sql immutable parallel safe set search_path = '' as
$$ select extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')) $$;

create table if not exists public.seances_comptes_rendus (
  uid text primary key,
  chambre text not null default 'AN',
  date_seance timestamptz not null,
  etat text,                 -- provisoire / définitif
  empreinte text,            -- md5 du fichier : une séance inchangée n'est pas relue
  url text,
  maj_le timestamptz not null default now()
);

create table if not exists public.seance_interventions (
  id text primary key,       -- id_syceron du premier paragraphe
  seance_uid text not null references public.seances_comptes_rendus(uid) on delete cascade,
  chambre text not null default 'AN',
  date_seance timestamptz not null,
  point text,                -- point de l'ordre du jour
  acteur_ref text,           -- identifiant officiel de l'orateur (PA…), député ou ministre
  orateur text,
  qualite text,              -- « ministre délégué chargé de… » quand l'orateur est au gouvernement
  texte text not null,
  ordre integer,
  recherche tsvector generated always as (to_tsvector('french', public.sans_accents(coalesce(point, '') || ' ' || texte))) stored
);

create index if not exists seance_interventions_recherche_idx on public.seance_interventions using gin (recherche);
create index if not exists seance_interventions_date_idx on public.seance_interventions (date_seance desc);
create index if not exists seance_interventions_acteur_idx on public.seance_interventions (acteur_ref, date_seance desc);
create index if not exists seance_interventions_seance_idx on public.seance_interventions (seance_uid);

alter table public.seances_comptes_rendus enable row level security;
alter table public.seance_interventions enable row level security;
drop policy if exists "seances : lecture Pro" on public.seances_comptes_rendus;
create policy "seances : lecture Pro" on public.seances_comptes_rendus for select using ((select public.est_pro()));
drop policy if exists "interventions : lecture Pro" on public.seance_interventions;
create policy "interventions : lecture Pro" on public.seance_interventions for select using ((select public.est_pro()));

-- Recherche : les interventions les plus pertinentes, avec l'extrait où apparaissent les mots.
create or replace function public.chercher_debats(p_q text, p_depuis date default null, p_acteur text default null, p_limite integer default 30, p_decalage integer default 0)
returns table (id text, seance_uid text, date_seance timestamptz, point text, acteur_ref text, orateur text, qualite text, extrait text, rang real, url text)
language sql stable security invoker set search_path = public as $$
  with q as (select websearch_to_tsquery('french', public.sans_accents(p_q)) as tq)
  select i.id, i.seance_uid, i.date_seance, i.point, i.acteur_ref, i.orateur, i.qualite,
         ts_headline('french', i.texte, (select tq from q), 'StartSel=[[, StopSel=]], MaxWords=45, MinWords=20, MaxFragments=2, FragmentDelimiter= … '),
         ts_rank(i.recherche, (select tq from q)) as rang,
         s.url
  from public.seance_interventions i
  join public.seances_comptes_rendus s on s.uid = i.seance_uid
  where i.recherche @@ (select tq from q)
    and (p_depuis is null or i.date_seance >= p_depuis)
    and (p_acteur is null or i.acteur_ref = p_acteur)
  order by i.date_seance desc, rang desc
  limit least(coalesce(p_limite, 30), 100) offset greatest(coalesce(p_decalage, 0), 0)
$$;

-- Qui en parle : orateurs et nombre d'interventions sur un sujet (sert aussi à la cartographie).
create or replace function public.qui_parle_de(p_q text, p_depuis date default null, p_limite integer default 20)
returns table (acteur_ref text, orateur text, qualite text, interventions bigint, derniere timestamptz)
language sql stable security invoker set search_path = public as $$
  select i.acteur_ref, max(i.orateur), max(i.qualite), count(*), max(i.date_seance)
  from public.seance_interventions i
  where i.recherche @@ websearch_to_tsquery('french', public.sans_accents(p_q))
    and (p_depuis is null or i.date_seance >= p_depuis)
    and i.acteur_ref is not null
  group by i.acteur_ref
  order by count(*) desc
  limit least(coalesce(p_limite, 20), 100)
$$;

grant execute on function public.chercher_debats(text, date, text, integer, integer) to authenticated;
grant execute on function public.qui_parle_de(text, date, integer) to authenticated;

-- Les veilles par sujet peuvent aussi surveiller les débats en séance.
alter table public.veilles alter column sources set default array['amendements', 'comptes_rendus', 'debats', 'journal_officiel', 'agenda', 'textes'];
