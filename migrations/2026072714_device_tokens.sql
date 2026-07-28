-- Jetons d'appareils pour les notifications push (app mobile Capacitor + FCM).
-- L'app enregistre son jeton ici (anon) ; l'envoi se fait côté service (service role).
create table if not exists public.device_tokens (
  token       text primary key,
  platform    text,                       -- 'ios' | 'android'
  user_id     uuid,
  email       text,
  premium     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.device_tokens enable row level security;

-- L'app (clé anon) peut enregistrer / mettre à jour son propre jeton.
drop policy if exists "device_tokens anon upsert" on public.device_tokens;
create policy "device_tokens anon upsert" on public.device_tokens for insert with check (true);
drop policy if exists "device_tokens anon update" on public.device_tokens;
create policy "device_tokens anon update" on public.device_tokens for update using (true) with check (true);
-- Pas de policy SELECT : seul le service role (envoi des push) lit la table.
