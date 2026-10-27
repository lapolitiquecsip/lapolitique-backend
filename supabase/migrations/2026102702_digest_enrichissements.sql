-- ─────────────────────────────────────────────────────────────────────────────
-- E-mails Pro : chaque information (loi, texte déposé, commission, acte du JO, vote
-- européen) est enrichie une fois par un agent IA (Claude), puis servie à tous les
-- membres qui l'ont choisie, au quotidien comme à l'hebdomadaire.
-- Lu et écrit par les scripts (clé de service) seulement : aucune politique publique.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.digest_enrichissements (
  cle        text primary key,            -- même clé que digest_items : « loi:… », « commission:… »
  contenu    jsonb,                       -- { essentiel, points[], concernes, rapport_de_force, suite, enjeu } ; null = rien de fiable
  sources    jsonb,                       -- adresses consultées en ligne par l'agent
  modele     text,
  cout_usd   numeric(8,5),
  cree_le    timestamptz not null default now()
);
alter table public.digest_enrichissements enable row level security;
create index if not exists digest_enrichissements_cree on public.digest_enrichissements (cree_le desc);
