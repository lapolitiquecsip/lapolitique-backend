-- Migration 002: Automation Tables for Petitions and Legislative Work

-- 1. petitions
CREATE TABLE IF NOT EXISTS public.petitions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  signatures INT DEFAULT 0,
  threshold INT DEFAULT 100000,
  institution TEXT CHECK (institution IN ('AN', 'Sénat')),
  category TEXT,
  url TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS for petitions
ALTER TABLE public.petitions ENABLE ROW LEVEL SECURITY;

-- Policies for petitions
CREATE POLICY "Public read access for petitions" ON public.petitions FOR SELECT USING (true);
CREATE POLICY "Admin full access for petitions" ON public.petitions FOR ALL USING (public.is_admin());

-- 2. Enhance events (agenda)
-- We add some constraints or utility columns if needed
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS type TEXT; -- 'séance pub', 'commission', 'gouvernement'
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS external_id TEXT UNIQUE; -- To avoid duplicates during scraping

-- 3. Trigger for updated_at on petitions
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_petitions_updated_at
BEFORE UPDATE ON public.petitions
FOR EACH ROW
EXECUTE PROCEDURE update_updated_at_column();
