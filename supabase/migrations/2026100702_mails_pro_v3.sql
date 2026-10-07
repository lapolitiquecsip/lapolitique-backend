-- E-mails Pro v3 : retours « pas intéressant », événements regroupés, relecture du
-- vendredi, résumés de vidéos.

-- 1. « Pas intéressant » : un clic dans l'e-mail, sans connexion (jeton personnel du membre).
create table if not exists public.retours_mails (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  categorie text not null,          -- suivis | local | sujets | textes | tele
  entite text,                      -- parti, candidat, ministère, commune, domaine…
  titre text,
  cree_le timestamptz not null default now()
);
create index if not exists retours_mails_user on public.retours_mails(user_id, categorie, entite);
alter table public.retours_mails enable row level security;
drop policy if exists "retours : les siens" on public.retours_mails;
create policy "retours : les siens" on public.retours_mails for select using (auth.uid() = user_id);

create or replace function public.signaler_pas_interessant(p_jeton uuid, p_categorie text, p_entite text, p_titre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid; n int;
begin
  select user_id into uid from user_preferences where jeton_desabo = p_jeton;
  if uid is null then return jsonb_build_object('ok', false); end if;
  if p_categorie not in ('suivis', 'local', 'sujets', 'textes', 'tele') then return jsonb_build_object('ok', false); end if;
  insert into retours_mails(user_id, categorie, entite, titre)
    values (uid, p_categorie, left(p_entite, 120), left(p_titre, 200));
  select count(*) into n from retours_mails where user_id = uid and categorie = p_categorie
    and coalesce(entite, '') = coalesce(left(p_entite, 120), '') and cree_le > now() - interval '60 days';
  return jsonb_build_object('ok', true, 'nb', n);
end $$;
grant execute on function public.signaler_pas_interessant(uuid, text, text, text) to anon, authenticated;

-- 2. Événement sous-jacent d'une actu (« Mediapart attribue des écrits… à J. Bardella »).
alter table public.tri_suivis add column if not exists evenement text;

-- 4. Relecture du vendredi : lignes retirées par l'éditeur, édito validé réutilisé samedi.
create table if not exists public.recap_exclusions (
  semaine date not null, cle text not null, titre text, cree_le timestamptz not null default now(),
  primary key (semaine, cle)
);
create table if not exists public.recap_editos (
  semaine date primary key, contenu jsonb not null, cree_le timestamptz not null default now()
);
alter table public.recap_exclusions enable row level security;
alter table public.recap_editos enable row level security;
create or replace function public.exclure_du_recap(p_semaine date, p_cle text, p_titre text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.est_administrateur() then return false; end if;
  insert into recap_exclusions(semaine, cle, titre) values (p_semaine, p_cle, left(p_titre, 200))
    on conflict (semaine, cle) do nothing;
  return true;
end $$;
grant execute on function public.exclure_du_recap(date, text, text) to authenticated;

-- 5. Résumé d'une vidéo (transcription → résumé factuel, chiffres vérifiés).
alter table public.candidate_videos add column if not exists resume_ia text;
alter table public.candidate_videos add column if not exists resume_le timestamptz;
alter table public.candidate_debates add column if not exists resume_ia text;
alter table public.candidate_debates add column if not exists resume_le timestamptz;

drop policy if exists "exclusions : lecture admin" on public.recap_exclusions;
create policy "exclusions : lecture admin" on public.recap_exclusions for select using (public.est_administrateur());
