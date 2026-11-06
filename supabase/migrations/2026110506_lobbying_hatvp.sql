-- Répertoire des représentants d'intérêts (HATVP) : chaque activité de lobbying déclarée, pour
-- « qui fait du lobbying sur ce sujet ? » (Pro, onglet « Qui pèse »). Relevé hebdomadaire
-- (sync-lobbying-hatvp.ts), données publiques sous Licence ouverte.

create table if not exists public.lobbying_activites (
  id text primary key,                 -- identifiant de la fiche d'activité à la HATVP
  organisation text not null,
  siren text,
  categorie text,
  secteurs text[] not null default '{}',
  objet text not null,
  domaines text[] not null default '{}',
  cibles text[] not null default '{}', -- décideurs publics visés (parlementaires, cabinets ministériels…)
  decisions text[] not null default '{}',
  actions text[] not null default '{}',
  exercice_debut date,
  exercice_fin date,
  publie_le date,
  url text,
  maj_le timestamptz not null default now(),
  recherche tsvector generated always as (to_tsvector('french', public.sans_accents(objet || ' ' || organisation))) stored
);
create index if not exists lobbying_activites_recherche_idx on public.lobbying_activites using gin (recherche);
create index if not exists lobbying_activites_exercice_idx on public.lobbying_activites (exercice_fin desc);
create index if not exists lobbying_activites_maj_idx on public.lobbying_activites (maj_le);

alter table public.lobbying_activites enable row level security;
drop policy if exists "lobbying : lecture Pro" on public.lobbying_activites;
create policy "lobbying : lecture Pro" on public.lobbying_activites for select using ((select public.est_pro()));

-- Les organisations qui déclarent le plus d'activités sur un sujet, avec leurs objets récents et
-- les décideurs qu'elles ciblent le plus.
create or replace function public.lobbying_sujet(p_q text, p_depuis date default null, p_limite integer default 20)
returns table (organisation text, categorie text, url text, activites bigint, derniere date, objets text[], cibles text[])
language sql stable security invoker set search_path = public as $$
  with q as (select websearch_to_tsquery('french', public.sans_accents(p_q)) as tq),
  a as (
    select * from public.lobbying_activites l
    where l.recherche @@ (select tq from q) and (p_depuis is null or coalesce(l.exercice_fin, l.publie_le) >= p_depuis)
  )
  select a.organisation, max(a.categorie), max(a.url), count(*), max(coalesce(a.publie_le, a.exercice_fin)),
         (array_agg(a.objet order by coalesce(a.publie_le, a.exercice_fin) desc nulls last))[1:3],
         (select array_agg(c order by n desc) from (select c, count(*) n from a a2, unnest(a2.cibles) c where a2.organisation = a.organisation group by c order by n desc limit 4) z)
  from a
  group by a.organisation
  order by count(*) desc
  limit least(coalesce(p_limite, 20), 100)
$$;
grant execute on function public.lobbying_sujet(text, date, integer) to authenticated;
