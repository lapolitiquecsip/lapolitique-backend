-- Propositions / idées d'un candidat, scrapées VERBATIM du site officiel de son mouvement
-- (ex. unenouvelleenergie.fr pour David Lisnard). Aucune reformulation, aucune invention :
-- on stocke le texte officiel + le lien source. Regroupées par thème.
create table if not exists public.candidate_proposals (
  id           text primary key,               -- md5(candidate_id|texte) : idempotent
  candidate_id uuid references public.presidential_candidates(id) on delete cascade,
  theme        text,                            -- ex. « Immigration », « Éducation »
  subsection   text,                            -- sous-titre éventuel
  text         text not null,                   -- la proposition, telle quelle
  source_url   text,                            -- page officielle d'origine
  sort_order   int default 0,
  updated_at   timestamptz not null default now()
);
create index if not exists candidate_proposals_candidate_idx on public.candidate_proposals(candidate_id, sort_order);

alter table public.candidate_proposals enable row level security;
drop policy if exists "candidate_proposals public read" on public.candidate_proposals;
create policy "candidate_proposals public read" on public.candidate_proposals for select using (true);
