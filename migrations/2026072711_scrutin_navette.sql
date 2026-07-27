-- Étape suivante (navette) d'un scrutin solennel de l'Assemblée, dérivée de l'ÉTAT RÉEL du
-- dossier parlementaire lié (source officielle) : « transmis au Sénat », « adopté
-- définitivement · devenue loi », etc. Rien n'est inventé : si aucun dossier n'est relié avec
-- certitude, aucune ligne n'est écrite (le front n'affiche alors pas d'étape suivante).
create table if not exists public.scrutin_navette (
  scrutin_id     text primary key references public.scrutins(id) on delete cascade,
  dossier_id     uuid,
  match_score    real,
  navette_status text,          -- 'definitif' | 'senat' | 'assemblee' | 'rejet' | null
  navette_label  text,          -- libellé prêt à afficher
  updated_at     timestamptz not null default now()
);

alter table public.scrutin_navette enable row level security;

drop policy if exists "scrutin_navette public read" on public.scrutin_navette;
create policy "scrutin_navette public read" on public.scrutin_navette for select using (true);
