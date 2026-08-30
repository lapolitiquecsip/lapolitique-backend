-- Fil vidéo par candidat à la présidentielle : métadonnées des vidéos de sa chaîne YouTube
-- officielle (discours, débats, interviews). On ne stocke que des métadonnées ; la lecture se
-- fait via l'embed YouTube officiel. Aucune donnée inventée : uniquement des chaînes vérifiées.
create table if not exists public.candidate_videos (
  video_id      text primary key,
  candidate_id  uuid references public.presidential_candidates(id) on delete cascade,
  title         text not null,
  published_at  timestamptz,
  url           text,
  thumbnail_url text,
  description   text,
  updated_at    timestamptz not null default now()
);
create index if not exists candidate_videos_candidate_idx on public.candidate_videos(candidate_id, published_at desc);

alter table public.candidate_videos enable row level security;
drop policy if exists "candidate_videos public read" on public.candidate_videos;
create policy "candidate_videos public read" on public.candidate_videos for select using (true);
