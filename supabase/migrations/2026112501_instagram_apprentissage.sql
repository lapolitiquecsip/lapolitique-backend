-- Instagram auto-apprenant (25/11/2026). Noémie (community manager) relève les statistiques du compte
-- @lapolitique_cest_simple, relie chaque post à sa fiche de fabrication, en tire des leçons chaque lundi
-- et propose une stratégie ajustée qu'Hippolyte valide sur WhatsApp (QG). Lecture : administrateur
-- (appli QG) ; écriture : scripts du dépôt backend (clé service).

-- Ce qui a servi à fabriquer un post (sujet, gabarit, palette, slides…), écrit à la préparation,
-- avant que le post n'existe sur Instagram. `ref` = la référence « ref:… » des fiches Notion.
create table if not exists public.instagram_fiches (
  ref text primary key,
  fiche jsonb not null default '{}'::jsonb,
  cree_le timestamptz not null default now()
);

-- Un post publié et ses DERNIERS chiffres (mis à jour à chaque relevé).
create table if not exists public.instagram_posts (
  media_id text primary key,
  format text not null,                 -- carrousel | reel | image
  publie_le timestamptz not null,
  permalink text,
  legende text,
  miniature text,
  ref text,                             -- fiche de fabrication (null pour les posts faits à la main)
  fiche jsonb not null default '{}'::jsonb,
  portee int, vues int, likes int, commentaires int, enregistrements int, partages int, reposts int,
  interactions int, visites_profil int, abonnements int, visionnage_moyen_ms int,
  score numeric,                        -- voir instagram-stats.ts (valeur pour 100 comptes touchés)
  maj_le timestamptz not null default now()
);
create index if not exists instagram_posts_publie_le on public.instagram_posts (publie_le desc);

-- Photo des chiffres d'un post à 24 h, 48 h, 7 jours et 30 jours : comparer des posts au même âge.
create table if not exists public.instagram_releves (
  media_id text not null references public.instagram_posts(media_id) on delete cascade,
  age_heures int not null,
  releve_le timestamptz not null default now(),
  mesures jsonb not null,
  primary key (media_id, age_heures)
);

-- Le compte, jour par jour (Instagram n'en garde que 90 jours : on les garde ici).
create table if not exists public.instagram_compte (
  jour date primary key,
  abonnes int, portee int, vues int, visites_profil int, comptes_engages int, clics_site int,
  interactions int, likes int, commentaires int, enregistrements int, partages int,
  heures_en_ligne jsonb,                -- abonnés en ligne par heure, HEURE DE PARIS (0-23)
  demographie jsonb,                    -- âge, genre, villes, pays (relevé le lundi)
  maj_le timestamptz not null default now()
);

-- Ce que Noémie a appris : analyse du lundi, consignes d'Hippolyte (« Modifier »), refus.
create table if not exists public.instagram_lecons (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  source text not null check (source in ('analyse', 'consigne', 'refus')),
  lecon text not null,
  preuve jsonb,
  active boolean not null default true
);

-- La stratégie de publication, versionnée. Une seule « active » ; une nouvelle version naît
-- « proposee » et ne devient active que validée par Hippolyte (demande QG).
create table if not exists public.instagram_strategie (
  version int primary key,
  statut text not null default 'proposee' check (statut in ('proposee', 'active', 'refusee', 'remplacee')),
  cree_le timestamptz not null default now(),
  active_depuis timestamptz,
  calendrier jsonb not null,            -- { lundi: [{ format, heure, contenu }], … }
  regles jsonb not null default '{}'::jsonb,
  raisons text,
  demande uuid
);
create unique index if not exists instagram_strategie_une_active on public.instagram_strategie (statut) where statut = 'active';

do $$
declare t text;
begin
  foreach t in array array['instagram_fiches', 'instagram_posts', 'instagram_releves', 'instagram_compte', 'instagram_lecons', 'instagram_strategie'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.est_administrateur())', t || '_admin', t);
  end loop;
end $$;
