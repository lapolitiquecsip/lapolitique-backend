-- Veilles par sujet (Pro) : un sujet décrit en une phrase, traduit en mots-clés, surveillé dans les
-- amendements (AN, Sénat), les comptes rendus de commission, le Journal officiel, l'agenda des deux
-- chambres et les nouveaux textes. Les trouvailles deviennent des alertes (user_notifications,
-- catégorie « veille ») envoyées au rythme choisi pour chaque veille (veilles-sujet.ts).

create table if not exists public.veilles (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  intitule text not null check (char_length(intitule) between 3 and 200),
  mots_cles text[] not null default '{}' check (cardinality(mots_cles) <= 30),
  exclusions text[] not null default '{}' check (cardinality(exclusions) <= 30),
  sources text[] not null default array['amendements', 'comptes_rendus', 'journal_officiel', 'agenda', 'textes'],
  rythme text not null default 'quotidien' check (rythme in ('immediat', 'quotidien', 'hebdo')),
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  -- Tout ce qui est arrivé avant cette date a déjà été examiné pour cette veille.
  verifie_jusqu_au timestamptz
);

create index if not exists veilles_user_idx on public.veilles (user_id);

alter table public.veilles enable row level security;

-- Le membre gère ses veilles ; en créer ou en modifier demande l'abonnement Pro.
drop policy if exists "veilles : lecture des siennes" on public.veilles;
create policy "veilles : lecture des siennes" on public.veilles
  for select using ((select auth.uid()) = user_id);
drop policy if exists "veilles : ecriture Pro" on public.veilles;
create policy "veilles : ecriture Pro" on public.veilles
  for insert with check ((select auth.uid()) = user_id and (select public.est_pro()));
drop policy if exists "veilles : modification Pro" on public.veilles;
create policy "veilles : modification Pro" on public.veilles
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and (select public.est_pro()));
drop policy if exists "veilles : suppression des siennes" on public.veilles;
create policy "veilles : suppression des siennes" on public.veilles
  for delete using ((select auth.uid()) = user_id);

-- Au plus 30 veilles par membre (garde-fou de coût et de lisibilité).
create or replace function public.veilles_plafond() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.veilles where user_id = new.user_id) >= 30 then
    raise exception 'Au plus 30 veilles par membre';
  end if;
  return new;
end $$;
drop trigger if exists veilles_plafond on public.veilles;
create trigger veilles_plafond before insert on public.veilles for each row execute function public.veilles_plafond();
