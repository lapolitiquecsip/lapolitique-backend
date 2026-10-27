-- ─────────────────────────────────────────────────────────────────────────────
-- Page Exécutif : les annonces du gouvernement (mesures, plans, budgets, réformes),
-- repérées plusieurs fois par jour et analysées en détail.
--   executif_sources  : chaque article ou communiqué repéré (collecteur, sans IA) et
--                       l'annonce à laquelle le trieur l'a rattaché.
--   executif_annonces : une ligne par annonce, avec l'analyse vérifiée (lecture publique).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.executif_annonces (
  id            uuid primary key default gen_random_uuid(),
  titre         text not null,
  chapo         text,
  ministere     text,
  porteur       text,                       -- qui a annoncé : « le Premier ministre », « la ministre de l'Éducation »…
  type          text,                       -- budget | plan | reforme | mesure | nomination | decret | international | autre
  importance    smallint not null default 3, -- 1 à 5
  date_annonce  date not null,
  montants      jsonb not null default '[]', -- [{ montant, objet, nature }]
  analyse_detail jsonb,                      -- mesures, concernés, calendrier, financement, contexte, réactions, zones d'ombre, suite
  sources       jsonb not null default '[]', -- [{ titre, media, url }]
  verifie       boolean not null default false,
  modele        text,
  cout_usd      numeric(8,5) not null default 0,
  nb_sources    integer not null default 0,
  analyse_le    timestamptz,
  publie        boolean not null default false,  -- visible sur le site une fois analysé
  cree_le       timestamptz not null default now(),
  maj_le        timestamptz not null default now()
);
create index if not exists executif_annonces_date on public.executif_annonces (date_annonce desc);
alter table public.executif_annonces enable row level security;
drop policy if exists "annonces : lecture publique" on public.executif_annonces;
create policy "annonces : lecture publique" on public.executif_annonces for select using (publie);
grant select on public.executif_annonces to anon, authenticated;

create table if not exists public.executif_sources (
  url         text primary key,
  titre       text not null,
  media       text,
  extrait     text,
  publie_le   timestamptz,
  origine     text,                          -- google-news | presse | vie-publique | content
  trie        boolean not null default false,
  pertinent   boolean,
  annonce_id  uuid references public.executif_annonces(id) on delete set null,
  cree_le     timestamptz not null default now()
);
create index if not exists executif_sources_a_trier on public.executif_sources (trie, cree_le desc);
create index if not exists executif_sources_annonce on public.executif_sources (annonce_id);
alter table public.executif_sources enable row level security;
