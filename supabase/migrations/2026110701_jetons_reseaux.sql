-- Jetons des réseaux sociaux renouvelés par les scripts de publication. Le jeton Instagram dure 60 jours :
-- publier-publications.ts le renouvelle chaque semaine et range ici la nouvelle valeur, que le secret
-- GitHub (posé une fois à la main) ne peut pas recevoir. Lisible par le seul service du site.
create table if not exists public.jetons_reseaux (
  plateforme text primary key,
  jeton text not null,
  compte text,
  expire_le timestamptz,
  maj_le timestamptz not null default now()
);
alter table public.jetons_reseaux enable row level security;
revoke all on public.jetons_reseaux from public, anon, authenticated;
grant select, insert, update on public.jetons_reseaux to service_role;
