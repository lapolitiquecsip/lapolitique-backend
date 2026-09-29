-- ─────────────────────────────────────────────────────────────────────────────
-- Campagne d'analyses approfondies (DeepSeek payant) : suivi du coût et des
-- dossiers sans texte lisible.
--
-- cout_usd : ce qu'a coûté chaque analyse, calculé d'après les tokens facturés.
-- Une campagne payante se pilote à la dépense réelle, pas à l'estimation.
--
-- dossier_analyses_tentatives : les dossiers dont aucun texte n'a pu être lu
-- (propositions de résolution, rapports, PDF pas encore publié). Sans cette
-- mémoire, chaque passage retéléchargeait les mêmes centaines de pages pour rien.
-- Ils sont retentés au bout de quelques jours : un PDF finit par paraître.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.dossier_analyses_approfondies add column if not exists cout_usd numeric(10, 5);

create table if not exists public.dossier_analyses_tentatives (
  dossier_id uuid primary key references public.legislative_dossiers(id) on delete cascade,
  raison text not null,
  tente_le timestamptz not null default now()
);

-- Table de travail du script (clé de service) : aucune lecture publique.
alter table public.dossier_analyses_tentatives enable row level security;
