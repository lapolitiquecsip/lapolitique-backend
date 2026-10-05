-- ─────────────────────────────────────────────────────────────────────────────
-- Veille automatique des controverses des personnalités politiques.
--
-- Les bios (deputies, senators, meps, minister_profiles, presidential_candidates,
-- department_presidents, presidents, mayors) portent une liste « controverses »
-- figée au moment où la bio a été rédigée. La veille lit la presse plusieurs
-- fois par jour et consigne ici chaque affaire nouvelle ; un passage « appliquer »
-- la recopie ensuite dans toutes les fiches de la personne. Conservée à part,
-- l'entrée survit aux régénérations de bios : elle est simplement réappliquée.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.controverses_veille (
  id          bigserial primary key,
  personne_cle text not null,              -- nom normalisé (sans accents, minuscules)
  personne    text not null,
  texte       text not null,               -- entrée telle qu'elle s'affiche sur la fiche
  date_faits  date,
  sources     jsonb not null default '[]', -- [{titre, media, url, date}]
  remplace    text,                        -- entrée de la bio que celle-ci complète et remplace
  origine     text not null default 'veille',  -- 'veille' (automatique) ou 'manuel'
  masquee     boolean not null default false,  -- retirer une entrée sans la supprimer
  creee_le    timestamptz not null default now(),
  maj_le      timestamptz not null default now()
);
create index if not exists controverses_veille_personne on public.controverses_veille (personne_cle);

-- Articles déjà examinés : un même article n'est soumis qu'une fois à l'IA.
create table if not exists public.controverses_articles_vus (
  url          text primary key,
  personne_cle text not null,
  vu_le        timestamptz not null default now()
);
create index if not exists controverses_articles_vus_date on public.controverses_articles_vus (vu_le);

-- Données internes : lecture et écriture par le seul rôle de service (crons).
alter table public.controverses_veille enable row level security;
alter table public.controverses_articles_vus enable row level security;
