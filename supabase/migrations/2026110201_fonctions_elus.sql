-- Les fonctions officielles des élus, relevées chaque semaine dans les données ouvertes du Sénat,
-- de l'Assemblée nationale et du Parlement européen, et le journal de ce qui change.
-- La fiche d'un élu lit ces tables, plus jamais le texte de sa biographie.

create table if not exists elus_fonctions (
  elu_kind    text not null check (elu_kind in ('depute', 'senateur', 'eurodepute', 'maire')),
  elu_slug    text not null,
  nom         text,
  categorie   text not null check (categorie in ('mandat', 'bureau', 'groupe', 'commission', 'organe', 'mandat_local')),
  cle         text not null,          -- stable d'une semaine à l'autre : identifiant de l'organe, sinon son nom
  libelle     text not null,          -- « Vice-présidente du Sénat », « Membre de la commission des lois »
  qualite     text,                   -- Président, Vice-président, Questeur, Secrétaire, Membre…
  organe      text,
  depuis      date,
  important   boolean not null default false,   -- seules les lignes importantes vont au journal
  source_url  text,
  maj_le      timestamptz not null default now(),
  primary key (elu_kind, elu_slug, categorie, cle)
);
create index if not exists elus_fonctions_elu on elus_fonctions (elu_kind, elu_slug);

create table if not exists elus_changements (
  id          bigserial primary key,
  elu_kind    text not null,
  elu_slug    text not null,
  nom         text,
  nature      text not null check (nature in ('ajout', 'retrait', 'modification', 'bio_corrigee')),
  categorie   text,
  avant       text,
  apres       text,
  source_url  text,
  detecte_le  timestamptz not null default now()
);
create index if not exists elus_changements_elu on elus_changements (elu_kind, elu_slug, detecte_le desc);
create index if not exists elus_changements_date on elus_changements (detecte_le desc);

-- Le dernier passage réussi par catégorie : la fiche peut dire « vérifié le… » sans réécrire chaque ligne.
create table if not exists elus_verification (
  elu_kind     text primary key,
  verifie_le   timestamptz not null,
  nb_fonctions integer not null default 0,
  nb_changements integer not null default 0
);

alter table elus_fonctions enable row level security;
alter table elus_changements enable row level security;
alter table elus_verification enable row level security;
drop policy if exists "Lecture publique" on elus_fonctions;
create policy "Lecture publique" on elus_fonctions for select using (true);
drop policy if exists "Lecture publique" on elus_changements;
create policy "Lecture publique" on elus_changements for select using (true);
drop policy if exists "Lecture publique" on elus_verification;
create policy "Lecture publique" on elus_verification for select using (true);
