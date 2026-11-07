-- Explorer IA (Pro) : questions posées en français, réponses sourcées sur nos données ; historique
-- et quota (20 par jour). Connecteur MCP : une clé personnelle par membre Pro pour interroger nos
-- données depuis son propre Claude ou ChatGPT ; seule l'empreinte (SHA-256) de la clé est gardée.

create table if not exists public.explorer_questions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  reponse text,
  sources jsonb,
  modele text,
  cout_usd numeric(10, 5) not null default 0,
  cree_le timestamptz not null default now()
);
create index if not exists explorer_questions_user_idx on public.explorer_questions (user_id, cree_le desc);
alter table public.explorer_questions enable row level security;
drop policy if exists "explorer : les siennes" on public.explorer_questions;
create policy "explorer : les siennes" on public.explorer_questions for select using ((select auth.uid()) = user_id);
drop policy if exists "explorer : effacer les siennes" on public.explorer_questions;
create policy "explorer : effacer les siennes" on public.explorer_questions for delete using ((select auth.uid()) = user_id);

create table if not exists public.mcp_cles (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  empreinte text not null unique,          -- sha256 de la clé ; la clé n'est montrée qu'une fois
  libelle text,
  cree_le timestamptz not null default now(),
  utilisee_le timestamptz,
  revoquee_le timestamptz
);
create index if not exists mcp_cles_user_idx on public.mcp_cles (user_id);
alter table public.mcp_cles enable row level security;
drop policy if exists "mcp : les siennes" on public.mcp_cles;
create policy "mcp : les siennes" on public.mcp_cles for select using ((select auth.uid()) = user_id);
