-- Performance Optimization Migration - 2026-05-07
-- Targeted at fixing slow page loads and Gateway Timeouts (504)

-- 1. Index for Events (Executive Agenda)
-- The query in api.ts filters by date range and orders by date.
CREATE INDEX IF NOT EXISTS idx_events_date ON public.events(date);

-- 2. Index for Petitions (Citizen Power)
-- The query in api.ts filters by institution and orders by signatures descending.
CREATE INDEX IF NOT EXISTS idx_petitions_inst_sigs ON public.petitions(institution, signatures DESC);

-- 3. Verify and reinforce Deputy Votes index
-- This is critical for the deputy profile pages.
CREATE INDEX IF NOT EXISTS idx_deputy_votes_an_id_date ON public.deputy_votes(deputy_an_id, date_scrutin DESC);

-- 4. Index for Scrutins sorting
-- The main laws feed orders by date.
CREATE INDEX IF NOT EXISTS idx_scrutins_date_type ON public.scrutins(date_scrutin DESC, type);

-- 5. Index for User Saved Items (Premium Dashboard)
-- Speed up retrieving saved items for a specific user.
CREATE INDEX IF NOT EXISTS idx_user_saved_items_user_id ON public.user_saved_items(user_id);
