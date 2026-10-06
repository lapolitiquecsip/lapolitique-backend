-- ─────────────────────────────────────────────────────────────────────────────
-- Alertes Pro personnalisées et récap hebdomadaire « La semaine politique en 5 minutes ».
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Réglages du membre.
--    recap_hebdo  : le récap du samedi (activé d'office, désactivable).
--    perimetre    : jusqu'où vont les alertes locales — sa commune, son département,
--                   sa région, ou aucune alerte locale (« national »).
--    rythmes      : par catégorie d'alerte, quand l'e-mail part :
--                   immediat (dans l'heure), quotidien (un résumé le soir),
--                   hebdo (seulement dans le récap du samedi), aucun.
--    jeton_desabo : lien de désabonnement en un clic, sans connexion.
alter table public.user_preferences
  add column if not exists recap_hebdo boolean not null default true,
  add column if not exists perimetre text not null default 'departement'
    check (perimetre in ('commune', 'departement', 'region', 'national')),
  add column if not exists rythmes jsonb not null default
    '{"votes":"immediat","local":"quotidien","suivis":"quotidien","lois":"hebdo"}'::jsonb,
  add column if not exists jeton_desabo uuid not null default gen_random_uuid();
create unique index if not exists user_preferences_jeton_desabo on public.user_preferences (jeton_desabo);

-- 2) Suivis élargis : partis, ministères, candidats, commissions (les élus restent
--    dans user_follows). ref = slug du parti, id du ministère ou du candidat,
--    « AN|Commission des finances » pour une commission.
create table if not exists public.user_suivis (
  id        bigserial primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  kind      text not null check (kind in ('parti', 'ministere', 'candidat', 'commission')),
  ref       text not null,
  label     text not null,
  cree_le   timestamptz not null default now(),
  unique (user_id, kind, ref)
);
alter table public.user_suivis enable row level security;
drop policy if exists "suivis : les siens" on public.user_suivis;
create policy "suivis : les siens" on public.user_suivis for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3) Catégorie de chaque alerte (votes, local, suivis, lois) : c'est elle qui décide
--    du rythme d'envoi. Les anciennes lignes sont classées d'après leur type.
alter table public.user_notifications add column if not exists categorie text;
update public.user_notifications set categorie = case
  when type in ('vote', 'scrutin') or position is not null then 'votes'
  when type = 'local' then 'local'
  when type = 'loi' then 'lois'
  else 'suivis' end
where categorie is null;

-- 4) Journal des récaps envoyés (un par membre et par semaine).
create table if not exists public.recaps_envoyes (
  user_id   uuid not null references auth.users(id) on delete cascade,
  semaine   date not null,           -- samedi de l'envoi
  envoye_le timestamptz not null default now(),
  nb_items  integer,
  primary key (user_id, semaine)
);
alter table public.recaps_envoyes enable row level security;

-- 5) Désabonnement en un clic depuis l'e-mail (sans être connecté) : le jeton suffit.
create or replace function public.desabonner_recap(p_jeton uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  update user_preferences set recap_hebdo = false, updated_at = now() where jeton_desabo = p_jeton;
  if not found then return 'inconnu'; end if;
  return 'ok';
end $$;
grant execute on function public.desabonner_recap(uuid) to anon, authenticated;
