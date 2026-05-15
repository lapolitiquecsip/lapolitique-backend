-- Create premium_dossiers table
CREATE TABLE IF NOT EXISTS public.premium_dossiers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL,
    status_label TEXT NOT NULL,
    color TEXT NOT NULL,
    background_image TEXT,
    summary TEXT NOT NULL,
    impacts JSONB DEFAULT '[]'::jsonb,
    premium_points JSONB DEFAULT '[]'::jsonb,
    calendar JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.premium_dossiers ENABLE ROW LEVEL SECURITY;

-- Allow public read access to dossiers (premium points filtering is handled by UI/API)
CREATE POLICY "Allow public read access to premium_dossiers" 
    ON public.premium_dossiers 
    FOR SELECT 
    USING (true);

-- Allow service role to manage dossiers
CREATE POLICY "Allow service role full access to premium_dossiers" 
    ON public.premium_dossiers 
    USING (true) 
    WITH CHECK (true);
