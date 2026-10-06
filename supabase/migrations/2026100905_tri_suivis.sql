-- Tri éditorial des actualités de partis et de candidats suivis (alertes Pro) : chaque
-- item est jugé UNE fois (nature, acteur, importance 1-5) puis réutilisé pour tous.
create table if not exists public.tri_suivis (
  cle text primary key,              -- md5(kind|ref|url ou titre)
  entite text not null,
  titre text not null,
  importance smallint not null,
  nature text not null,              -- fait | declaration | reaction | analyse | sondage
  acteur boolean not null,           -- l'entité suivie est-elle l'auteur ou le sujet direct du fait ?
  raison text,
  methode text not null default 'ia',  -- ia | regles (secours sans IA)
  cree_le timestamptz not null default now()
);
alter table public.tri_suivis enable row level security;   -- lecture réservée au backend
