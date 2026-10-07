-- Programmes publiés autrement que sur une page web : présentation vidéo officielle
-- (chaîne YouTube du candidat), PDF… Une ligne par source traitée, pour ne jamais la
-- retraiter et savoir d'où vient chaque proposition (candidate_proposals.source_url).
create table if not exists public.programmes_sources (
  source_url text primary key,
  candidate_id uuid not null,
  titre text,
  statut text not null,             -- programme | pas_un_programme | transcription_impossible
  nb_propositions int not null default 0,
  methode text,                     -- sous-titres | gemini
  traite_le timestamptz not null default now()
);
alter table public.programmes_sources enable row level security;
drop policy if exists "programmes_sources lisibles" on public.programmes_sources;
create policy "programmes_sources lisibles" on public.programmes_sources for select using (true);
