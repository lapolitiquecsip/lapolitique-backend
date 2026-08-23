-- Préférences des membres premium (profil pour les notifications personnalisées) +
-- extension du fil de notifications aux notifications THÉMATIQUES (au-delà des votes suivis).

-- 1) Profil / préférences de notification, une ligne par membre.
create table if not exists public.user_preferences (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  age_range          text,                       -- ex. "25-34"
  profession         text,                       -- ex. "salarie_prive"
  region             text,
  department         text,
  city               text,
  postal_code        text,
  interests          text[] not null default '{}',   -- codes de domaines (interestDomains.ts)
  notify_email       boolean not null default true,  -- recevoir aussi par e-mail
  email_min_importance smallint not null default 3,  -- 1..5 : seuil au-dessus duquel un e-mail part
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

-- Chaque membre ne voit et ne modifie que ses propres préférences.
drop policy if exists "user_preferences_select_own" on public.user_preferences;
create policy "user_preferences_select_own" on public.user_preferences
  for select using (auth.uid() = user_id);

drop policy if exists "user_preferences_insert_own" on public.user_preferences;
create policy "user_preferences_insert_own" on public.user_preferences
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_preferences_update_own" on public.user_preferences;
create policy "user_preferences_update_own" on public.user_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) Colonnes pour les notifications thématiques (lois, décisions, actualités…).
alter table public.user_notifications add column if not exists domain     text;      -- code de domaine
alter table public.user_notifications add column if not exists importance smallint not null default 3;  -- 1..5
alter table public.user_notifications add column if not exists url        text;      -- lien vers le contenu

-- Index pour retrouver vite les notifs non envoyées par e-mail au-dessus du seuil d'importance.
create index if not exists user_notifications_email_queue_idx
  on public.user_notifications (user_id, importance)
  where emailed_at is null;
