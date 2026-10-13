-- Le compte rendu intégral de chaque réunion de commission, conservé sur le site.
--
-- Jusqu'ici le texte n'était lu qu'au moment de l'analyse, puis jeté : le bouton « Compte
-- rendu » renvoyait l'abonné sur le site de l'Assemblée ou du Sénat, et la transcription des
-- auditions filmées était perdue aussitôt analysée. Il est maintenant gardé ici, dans une
-- table à part pour ne pas alourdir les listes de réunions.
--
-- Textes publics (open data de l'Assemblée, Licence Ouverte du Sénat) : lecture libre.
create table if not exists public.commission_transcripts (
  ref text primary key,
  texte text not null,
  mots int not null default 0,
  source text not null default 'compte_rendu',   -- compte_rendu | transcription
  maj_le timestamptz not null default now()
);
alter table public.commission_transcripts enable row level security;
drop policy if exists "commission_transcripts lisibles" on public.commission_transcripts;
create policy "commission_transcripts lisibles" on public.commission_transcripts for select using (true);
