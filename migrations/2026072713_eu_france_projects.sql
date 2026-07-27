-- Projets concrets cofinancés par l'UE en France (base officielle Kohesio, DG REGIO).
-- Nom, montant UE, budget total, région, coordonnées, image, lien vers la fiche Kohesio.
create table if not exists public.eu_france_projects (
  id               text primary key,          -- identifiant Kohesio (QID)
  name             text not null,
  eu_budget_eur    bigint,
  total_budget_eur bigint,
  region           text,
  lat              double precision,
  lng              double precision,
  image_url        text,
  description      text,
  url              text,
  updated_at       timestamptz not null default now()
);
alter table public.eu_france_projects enable row level security;
drop policy if exists "eu_france_projects public read" on public.eu_france_projects;
create policy "eu_france_projects public read" on public.eu_france_projects for select using (true);
