-- ─────────────────────────────────────────────────────────────────────────────
-- Offre Pro : e-mails à la carte (par catégorie, chaque jour ou chaque semaine) et
-- amendements de l'Assemblée en temps réel. Le fil d'actualité de l'accueil a été
-- retiré ; sa collecte (table content) nourrit désormais l'espace Pro.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Le membre est-il Pro ? (lecture des tables réservées)
create or replace function public.est_pro()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and subscription_tier = 'pro');
$$;
grant execute on function public.est_pro() to anon, authenticated;

-- 2) Abonnements e-mail, par catégorie : 'quotidien' | 'hebdo' | 'aucun'.
--    commissions : résumés des auditions et réunions de commission (AN + Sénat)
--    textes      : nouvelles lois, propositions et projets de loi
--    jo          : Journal officiel
--    elus        : actualités des élus et organisations suivis
--    europe      : votes du Parlement européen
--    territoire  : actualités de sa commune, son département, sa région
--    Rien d'office : le membre coche ce qu'il souhaite recevoir.
alter table public.user_preferences
  add column if not exists abonnements_pro jsonb not null default '{}'::jsonb;

-- 3) Journal des envois (un e-mail par membre, par rythme et par période).
create table if not exists public.digests_envoyes (
  user_id   uuid not null references auth.users(id) on delete cascade,
  rythme    text not null check (rythme in ('quotidien', 'hebdo')),
  periode   date not null,            -- jour d'envoi (quotidien) ou lundi de la semaine (hebdo)
  envoye_le timestamptz not null default now(),
  nb_items  integer,
  primary key (user_id, rythme, periode)
);
alter table public.digests_envoyes enable row level security;

-- Ce qui est déjà parti, par rythme (clé = « commission:… », « loi:… », « ue:… ») : une
-- information n'est servie qu'une fois, même quand elle arrive en base avec du retard.
create table if not exists public.digest_items (
  rythme    text not null,
  cle       text not null,
  envoye_le timestamptz not null default now(),
  primary key (rythme, cle)
);
alter table public.digest_items enable row level security;

-- 4) Désabonnement d'une catégorie en un clic depuis l'e-mail (jeton personnel, sans connexion).
create or replace function public.desabonner_digest(p_jeton uuid, p_categorie text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if p_categorie = 'tout' then
    update user_preferences set abonnements_pro = '{}'::jsonb, updated_at = now() where jeton_desabo = p_jeton;
  elsif p_categorie in ('commissions', 'textes', 'jo', 'elus', 'europe', 'territoire') then
    update user_preferences set abonnements_pro = abonnements_pro || jsonb_build_object(p_categorie, 'aucun'), updated_at = now()
     where jeton_desabo = p_jeton;
  else
    return 'inconnu';
  end if;
  if not found then return 'inconnu'; end if;
  return 'ok';
end $$;
grant execute on function public.desabonner_digest(uuid, text) to anon, authenticated;

-- 5) Amendements déposés à l'Assemblée nationale, relevés toutes les heures (Eliasse).
--    vu_le = première fois que le collecteur l'a vu (Eliasse ne donne pas la date de dépôt).
create table if not exists public.amendements_an (
  uid            text primary key,             -- AMANR5L17PO838901B3210P1D1N000312
  numero         text not null,                -- « I-312 », « CF1204 »…
  texte_uid      text not null,
  texte_titre    text,
  texte_numero   text,                         -- n° de dépôt (bibard)
  examen_uid     text not null,
  organe_ref     text,
  organe         text,                         -- « Séance », « Commission des finances »…
  division       text,                         -- « Article 12 », « Après l'article 3 »…
  ordre          text,                         -- ordre de discussion (tri)
  sort           text,                         -- Adopté, Rejeté, Tombé, Retiré, Non soutenu… (null = pas encore examiné)
  auteur_ref     text,                         -- PA… (= deputies.an_id) ou Gouvernement / commission
  auteur         text,
  auteur_type    text,                         -- Député, Gouvernement, Rapporteur…
  groupe         text,                         -- groupe politique de l'auteur (deputies.party)
  depute_slug    text,
  cosignataires  text,
  nb_cosignataires integer,
  sous_amendement boolean not null default false,
  dispositif     text,                         -- HTML de l'AN, nettoyé
  expose         text,                         -- exposé sommaire (HTML nettoyé)
  url            text,
  vu_le          timestamptz not null default now(),
  maj_le         timestamptz not null default now(),
  sort_le        timestamptz                   -- quand le sort a été connu
);
create index if not exists amendements_an_vu on public.amendements_an (vu_le desc);
create index if not exists amendements_an_texte on public.amendements_an (texte_uid, ordre);
create index if not exists amendements_an_auteur on public.amendements_an (auteur_ref);
create index if not exists amendements_an_groupe on public.amendements_an (groupe);
alter table public.amendements_an enable row level security;
drop policy if exists "amendements : membres Pro" on public.amendements_an;
create policy "amendements : membres Pro" on public.amendements_an for select using ((select public.est_pro()));  -- évalué une fois par requête

-- Textes en cours d'examen (liste des filtres), lue sans parcourir toute la table.
create or replace view public.amendements_an_textes with (security_invoker = true) as
  select texte_uid, max(texte_titre) as texte_titre, max(texte_numero) as texte_numero,
         count(*)::int as nb, max(vu_le) as dernier
    from public.amendements_an group by texte_uid;
grant select on public.amendements_an_textes to authenticated;
