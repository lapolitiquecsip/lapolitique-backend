-- Publications récentes des comptes suivis par la veille réseaux sociaux (30/10/2026) : vues, j'aime,
-- commentaires et partages publics, avec leur date. Purgées après 90 jours par le relevé quotidien.
create table if not exists public.candidate_social_posts (
  account_id uuid not null references public.candidate_social_accounts(id) on delete cascade,
  candidate_id uuid not null,
  platform text not null,
  post_id text not null,
  url text not null,
  texte text,
  publie_le timestamptz not null,
  vues bigint,
  likes bigint,
  commentaires bigint,
  partages bigint,
  est_video boolean not null default false,
  releve_le date not null default current_date,
  primary key (account_id, post_id)
);
create index if not exists candidate_social_posts_date on public.candidate_social_posts (publie_le desc);
alter table public.candidate_social_posts enable row level security;
drop policy if exists "lecture publique" on public.candidate_social_posts;
create policy "lecture publique" on public.candidate_social_posts for select using (true);
grant select on public.candidate_social_posts to anon, authenticated;
