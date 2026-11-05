-- Index de recherche plein texte des amendements (Assemblée, Sénat) : la cartographie « qui pèse »
-- recalculait le texte de 32 000 amendements à chaque recherche et dépassait le délai de la base.
-- Colonne calculée une fois (dispositif + exposé, sans balises ni accents), index GIN.

alter table public.amendements_an add column if not exists recherche tsvector
  generated always as (to_tsvector('french', public.sans_accents(regexp_replace(coalesce(dispositif, '') || ' ' || coalesce(expose, ''), '<[^>]+>', ' ', 'g')))) stored;
alter table public.amendements_senat add column if not exists recherche tsvector
  generated always as (to_tsvector('french', public.sans_accents(regexp_replace(coalesce(dispositif, '') || ' ' || coalesce(expose, ''), '<[^>]+>', ' ', 'g')))) stored;
create index if not exists amendements_an_recherche_idx on public.amendements_an using gin (recherche);
create index if not exists amendements_senat_recherche_idx on public.amendements_senat using gin (recherche);

create or replace function public.cartographie_sujet(p_q text, p_depuis date default null, p_limite integer default 60)
returns table (chambre text, slug text, nom text, groupe text, interventions bigint, amendements bigint, adoptes bigint, score bigint)
language sql stable security invoker set search_path = public as $$
  with q as (select websearch_to_tsquery('french', public.sans_accents(p_q)) as tq),
  inter as (
    select d.slug, count(*) as n
    from public.seance_interventions i join public.deputies d on d.an_id = i.acteur_ref
    where i.recherche @@ (select tq from q) and (p_depuis is null or i.date_seance >= p_depuis)
    group by d.slug
  ),
  amdt_an as (
    select a.depute_slug as slug, count(*) as n, count(*) filter (where a.sort = 'Adopté') as ad
    from public.amendements_an a
    where a.depute_slug is not null and (p_depuis is null or a.vu_le >= p_depuis) and a.recherche @@ (select tq from q)
    group by 1
  ),
  amdt_sen as (
    select a.senateur_slug as slug, count(*) as n, count(*) filter (where a.sort = 'Adopté') as ad
    from public.amendements_senat a
    where a.senateur_slug is not null and (p_depuis is null or coalesce(a.depose_le, a.vu_le) >= p_depuis) and a.recherche @@ (select tq from q)
    group by 1
  )
  select * from (
    select 'AN'::text as chambre, d.slug, d.first_name || ' ' || d.last_name as nom, d.party as groupe,
           coalesce(i.n, 0) as interventions, coalesce(a.n, 0) as amendements, coalesce(a.ad, 0) as adoptes,
           coalesce(i.n, 0) + 2 * coalesce(a.n, 0) + 5 * coalesce(a.ad, 0) as score
    from public.deputies d
    left join inter i on i.slug = d.slug
    left join amdt_an a on a.slug = d.slug
    where i.n is not null or a.n is not null
    union all
    select 'SENAT'::text, s.slug, s.first_name || ' ' || s.last_name, s.senate_group,
           0::bigint, a.n, a.ad, 2 * a.n + 5 * a.ad
    from public.senators s join amdt_sen a on a.slug = s.slug
  ) t
  order by score desc
  limit least(coalesce(p_limite, 60), 200)
$$;

create or replace function public.cosignatures_sujet(p_q text, p_depuis date default null)
returns table (chambre text, slug text, groupe text, cosignataires text, sort text)
language sql stable security invoker set search_path = public as $$
  with q as (select websearch_to_tsquery('french', public.sans_accents(p_q)) as tq)
  select 'AN'::text, a.depute_slug, a.groupe, a.cosignataires, a.sort
  from public.amendements_an a
  where a.depute_slug is not null and coalesce(a.nb_cosignataires, 0) > 0 and (p_depuis is null or a.vu_le >= p_depuis) and a.recherche @@ (select tq from q)
  union all
  select 'SENAT'::text, a.senateur_slug, a.groupe, a.cosignataires, a.sort
  from public.amendements_senat a
  where a.senateur_slug is not null and coalesce(a.nb_cosignataires, 0) > 0 and (p_depuis is null or coalesce(a.depose_le, a.vu_le) >= p_depuis) and a.recherche @@ (select tq from q)
  limit 3000
$$;
