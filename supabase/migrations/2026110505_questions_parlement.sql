-- Questions des députés au Gouvernement (Pro) : questions écrites et questions au Gouvernement,
-- avec la réponse du ministre (sync-questions-an.ts). Recherche plein texte, et prises en compte
-- dans la cartographie « qui pèse » (1 point par question sur le sujet).

create table if not exists public.questions_parlement (
  uid text primary key,
  type text not null,              -- QE (écrite) / QG (au Gouvernement, en séance)
  numero text,
  rubrique text,
  objet text,                      -- l'objet de la question, en quelques mots (« analyse » à l'AN)
  acteur_ref text,                 -- identifiant officiel de l'auteur (PA…)
  groupe text,
  ministere text,
  date_question date,
  texte_question text,
  date_reponse date,
  texte_reponse text,
  statut text,                     -- repondue / en attente / close : …
  url text,
  maj_le timestamptz not null default now(),
  recherche tsvector generated always as (to_tsvector('french', public.sans_accents(coalesce(objet, '') || ' ' || coalesce(rubrique, '') || ' ' || coalesce(texte_question, '')))) stored
);
create index if not exists questions_parlement_recherche_idx on public.questions_parlement using gin (recherche);
create index if not exists questions_parlement_date_idx on public.questions_parlement (date_question desc);
create index if not exists questions_parlement_acteur_idx on public.questions_parlement (acteur_ref);
create index if not exists questions_parlement_maj_idx on public.questions_parlement (maj_le desc);

alter table public.questions_parlement enable row level security;
drop policy if exists "questions : lecture Pro" on public.questions_parlement;
create policy "questions : lecture Pro" on public.questions_parlement for select using ((select public.est_pro()));

create or replace function public.chercher_questions(p_q text, p_depuis date default null, p_statut text default null, p_limite integer default 30, p_decalage integer default 0)
returns table (uid text, type text, numero text, objet text, acteur_ref text, groupe text, ministere text, date_question date, date_reponse date, statut text, extrait text, url text)
language sql stable security invoker set search_path = public as $$
  with q as (select websearch_to_tsquery('french', public.sans_accents(p_q)) as tq)
  select x.uid, x.type, x.numero, x.objet, x.acteur_ref, x.groupe, x.ministere, x.date_question, x.date_reponse, x.statut,
         ts_headline('french', coalesce(x.texte_question, x.objet, ''), (select tq from q), 'StartSel=[[, StopSel=]], MaxWords=40, MinWords=15, MaxFragments=1'),
         x.url
  from public.questions_parlement x
  where x.recherche @@ (select tq from q)
    and (p_depuis is null or x.date_question >= p_depuis)
    and (p_statut is null or (p_statut = 'repondue' and x.statut = 'repondue') or (p_statut = 'attente' and x.statut = 'en attente'))
  order by x.date_question desc nulls last
  limit least(coalesce(p_limite, 30), 100) offset greatest(coalesce(p_decalage, 0), 0)
$$;
grant execute on function public.chercher_questions(text, date, text, integer, integer) to authenticated;

-- Cartographie : on ajoute les questions (colonne de plus, d'où le remplacement de la fonction).
drop function if exists public.cartographie_sujet(text, date, integer);
create function public.cartographie_sujet(p_q text, p_depuis date default null, p_limite integer default 60)
returns table (chambre text, slug text, nom text, groupe text, interventions bigint, questions bigint, amendements bigint, adoptes bigint, score bigint)
language sql stable security invoker set search_path = public as $$
  with q as (select websearch_to_tsquery('french', public.sans_accents(p_q)) as tq),
  inter as (
    select d.slug, count(*) as n
    from public.seance_interventions i join public.deputies d on d.an_id = i.acteur_ref
    where i.recherche @@ (select tq from q) and (p_depuis is null or i.date_seance >= p_depuis)
    group by d.slug
  ),
  quest as (
    select d.slug, count(*) as n
    from public.questions_parlement x join public.deputies d on d.an_id = x.acteur_ref
    where x.recherche @@ (select tq from q) and (p_depuis is null or x.date_question >= p_depuis)
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
           coalesce(i.n, 0) as interventions, coalesce(qu.n, 0) as questions, coalesce(a.n, 0) as amendements, coalesce(a.ad, 0) as adoptes,
           coalesce(i.n, 0) + coalesce(qu.n, 0) + 2 * coalesce(a.n, 0) + 5 * coalesce(a.ad, 0) as score
    from public.deputies d
    left join inter i on i.slug = d.slug
    left join quest qu on qu.slug = d.slug
    left join amdt_an a on a.slug = d.slug
    where i.n is not null or qu.n is not null or a.n is not null
    union all
    select 'SENAT'::text, s.slug, s.first_name || ' ' || s.last_name, s.senate_group,
           0::bigint, 0::bigint, a.n, a.ad, 2 * a.n + 5 * a.ad
    from public.senators s join amdt_sen a on a.slug = s.slug
  ) t
  order by score desc
  limit least(coalesce(p_limite, 60), 200)
$$;
grant execute on function public.cartographie_sujet(text, date, integer) to authenticated;

alter table public.veilles alter column sources set default array['amendements', 'comptes_rendus', 'debats', 'questions', 'journal_officiel', 'agenda', 'textes'];
