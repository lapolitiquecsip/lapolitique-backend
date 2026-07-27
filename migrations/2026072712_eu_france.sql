-- VOLET A — Décisions/communiqués de l'UE concernant la France, issus du flux OFFICIEL du
-- press corner de la Commission européenne. Filtrés : on ne garde que ce qui concerne
-- réellement la France (détection sur titre + résumé). Automatisé, quotidien.
create table if not exists public.eu_france_decisions (
  id            text primary key,            -- code de référence du communiqué (ex. ip_26_1661)
  title         text not null,
  summary       text,
  url           text not null,
  published_at  timestamptz,
  category      text,                         -- Aides d'État | Financement | Infractions | Numérique | ...
  institution   text not null default 'Commission européenne',
  updated_at    timestamptz not null default now()
);
alter table public.eu_france_decisions enable row level security;
drop policy if exists "eu_france_decisions public read" on public.eu_france_decisions;
create policy "eu_france_decisions public read" on public.eu_france_decisions for select using (true);

-- VOLET B — France ↔ budget de l'UE (donnée curée annuelle, source officielle citée).
-- Une ligne par année : contribution de la France, dépenses de l'UE en France, et détail
-- des dépenses par grand programme (JSON : [{label, amount_eur}]).
create table if not exists public.eu_france_budget (
  year             int primary key,
  contribution_eur bigint,                    -- ce que la France verse au budget de l'UE
  spending_eur     bigint,                    -- ce que l'UE dépense en France
  breakdown        jsonb,                      -- [{ "label": "PAC", "amount_eur": 9500000000 }, ...]
  source_url       text,
  source_label     text,
  updated_at       timestamptz not null default now()
);
alter table public.eu_france_budget enable row level security;
drop policy if exists "eu_france_budget public read" on public.eu_france_budget;
create policy "eu_france_budget public read" on public.eu_france_budget for select using (true);
