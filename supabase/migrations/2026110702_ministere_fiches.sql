-- Fiches ministères : budget (proposé, voté, dépensé), emplois, résultats et questions écrites, lus dans
-- les textes officiels par python/fiches_ministeres.py (cron hebdomadaire ministeres-sync.yml).
-- Une ligne par ministère (slug de /executif/ministere/[slug]) et par rubrique. Lecture publique.
create table if not exists public.ministere_fiches (
  slug text not null,
  rubrique text not null check (rubrique in ('budget', 'emplois', 'performance', 'questions')),
  donnees jsonb not null,
  sources jsonb not null default '[]'::jsonb,
  maj_le timestamptz not null default now(),
  primary key (slug, rubrique)
);
alter table public.ministere_fiches enable row level security;
drop policy if exists "ministere_fiches lecture" on public.ministere_fiches;
create policy "ministere_fiches lecture" on public.ministere_fiches for select using (true);
revoke all on public.ministere_fiches from anon, authenticated;
grant select on public.ministere_fiches to anon, authenticated;
grant select, insert, update, delete on public.ministere_fiches to service_role;
