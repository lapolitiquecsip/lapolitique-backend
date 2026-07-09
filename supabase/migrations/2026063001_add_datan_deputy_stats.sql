-- Migration: Add Datan Deputy Statistics and Contact Info - 2026-06-30

ALTER TABLE public.deputies ADD COLUMN IF NOT EXISTS nombre_mandats INT;
ALTER TABLE public.deputies ADD COLUMN IF NOT EXISTS experience_depute TEXT;
ALTER TABLE public.deputies ADD COLUMN IF NOT EXISTS score_participation_specialite NUMERIC;
ALTER TABLE public.deputies ADD COLUMN IF NOT EXISTS score_majorite NUMERIC;
ALTER TABLE public.deputies ADD COLUMN IF NOT EXISTS date_maj DATE;
ALTER TABLE public.deputies ADD COLUMN IF NOT EXISTS date_prise_fonction DATE;
ALTER TABLE public.deputies ADD COLUMN IF NOT EXISTS job TEXT;
ALTER TABLE public.deputies ADD COLUMN IF NOT EXISTS mail TEXT;
ALTER TABLE public.deputies ADD COLUMN IF NOT EXISTS twitter TEXT;
ALTER TABLE public.deputies ADD COLUMN IF NOT EXISTS facebook TEXT;
ALTER TABLE public.deputies ADD COLUMN IF NOT EXISTS website TEXT;
