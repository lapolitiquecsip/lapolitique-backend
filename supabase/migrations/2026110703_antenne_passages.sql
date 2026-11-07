-- Temps d'antenne des candidats au jour le jour (scripts/temps-antenne.ts du dépôt du site, cron horaire) :
-- chaque passage d'un candidat dans une émission mise en ligne par une chaîne de télévision ou de radio.
-- Complète le temps de parole officiel de l'Arcom (arcom_temps_parole), publié avec six semaines de retard.
create table if not exists public.antenne_passages (
  video_id text not null,
  slug text not null,                 -- presidential_candidates.slug
  media text not null,
  type_media text not null check (type_media in ('tv', 'radio')),
  titre text not null,
  url text not null,
  publie_le timestamptz not null,
  duree_s integer not null,
  format text not null check (format in ('entretien', 'debat', 'extrait')),
  secondes_attribuees integer not null default 0,
  releve_le timestamptz not null default now(),
  primary key (video_id, slug)
);
create index if not exists antenne_passages_date on public.antenne_passages (publie_le desc);
alter table public.antenne_passages enable row level security;
drop policy if exists "antenne_passages lecture" on public.antenne_passages;
create policy "antenne_passages lecture" on public.antenne_passages for select using (true);
revoke all on public.antenne_passages from anon, authenticated;
grant select on public.antenne_passages to anon, authenticated;
grant select, insert, update, delete on public.antenne_passages to service_role;
