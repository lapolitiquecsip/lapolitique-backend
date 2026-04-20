-- Migration 001: Initial Schema

-- Helper function to check admin role
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1. profiles
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role TEXT DEFAULT 'user'::text,
  display_name TEXT
);

-- 2. content
CREATE TABLE public.content (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  titre_original TEXT,
  titre_simplifie TEXT,
  resume_flash TEXT,
  resume_detaille TEXT,
  source_url TEXT,
  institution TEXT CHECK (institution IN ('assemblée', 'sénat', 'gouvernement')),
  date_publication TIMESTAMPTZ,
  date_traitement TIMESTAMPTZ,
  raw_text TEXT,
  status TEXT DEFAULT 'published'::text,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_content_inst_date ON public.content(institution, date_publication);

-- 3. events
CREATE TABLE public.events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE,
  title TEXT,
  description TEXT,
  institution TEXT,
  category TEXT,
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. politicians
CREATE TABLE public.politicians (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  photo_url TEXT,
  role TEXT,
  party TEXT,
  constituency TEXT,
  an_id TEXT
);

-- 5. promises
CREATE TABLE public.promises (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  politician_id UUID REFERENCES public.politicians(id) ON DELETE CASCADE,
  quote TEXT,
  source_url TEXT,
  date_made DATE,
  status TEXT CHECK (status IN ('kept', 'in_progress', 'broken', 'pending')),
  category TEXT,
  last_updated TIMESTAMPTZ DEFAULT now(),
  evidence_url TEXT,
  updated_by UUID REFERENCES auth.users(id)
);
CREATE INDEX idx_promises_pol_stat ON public.promises(politician_id, status);

-- 6. vocabulary
CREATE TABLE public.vocabulary (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  term TEXT,
  definition TEXT,
  example TEXT,
  category TEXT,
  difficulty INT CHECK (difficulty BETWEEN 1 AND 3),
  related_terms TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_vocabulary_cat ON public.vocabulary(category);

-- 7. deputies
CREATE TABLE public.deputies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  photo_url TEXT,
  party TEXT,
  party_color TEXT,
  department TEXT,
  constituency_number INT,
  an_id TEXT
);
CREATE INDEX idx_deputies_party_dept ON public.deputies(party, department);

-- 8. bills
CREATE TABLE public.bills (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT,
  description TEXT,
  date DATE,
  category TEXT,
  result TEXT
);

-- 9. votes
CREATE TABLE public.votes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deputy_id UUID REFERENCES public.deputies(id) ON DELETE CASCADE,
  bill_id UUID REFERENCES public.bills(id) ON DELETE CASCADE,
  vote TEXT CHECK (vote IN ('for', 'against', 'abstain', 'absent')),
  date DATE
);
CREATE INDEX idx_votes_dep_date ON public.votes(deputy_id, date);

-- 10. laws
CREATE TABLE public.laws (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT,
  summary TEXT,
  context TEXT,
  content TEXT,
  impact TEXT,
  date_adopted DATE,
  category TEXT,
  timeline JSONB,
  vote_result TEXT,
  source_urls TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 11. subscribers
CREATE TABLE public.subscribers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE,
  age_range TEXT,
  socio_pro_category TEXT,
  postal_code TEXT,
  department TEXT,
  constituency TEXT,
  frequency TEXT CHECK (frequency IN ('weekly', 'monthly')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT DEFAULT 'trial'::text,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 12. newsletter_editions
CREATE TABLE public.newsletter_editions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subscriber_id UUID REFERENCES public.subscribers(id) ON DELETE CASCADE,
  content JSONB,
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ
);

-- 13. pipeline_logs
CREATE TABLE public.pipeline_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_name TEXT,
  run_at TIMESTAMPTZ DEFAULT now(),
  items_processed INT,
  items_errors INT,
  status TEXT,
  error_details TEXT
);

-- 14. admin_config
CREATE TABLE public.admin_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ENABLE RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.politicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vocabulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deputies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laws ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;

-- POLICIES

-- Read-only default for public (anon & authenticated)
CREATE POLICY "Public read access for content" ON public.content FOR SELECT USING (true);
CREATE POLICY "Public read access for events" ON public.events FOR SELECT USING (true);
CREATE POLICY "Public read access for politicians" ON public.politicians FOR SELECT USING (true);
CREATE POLICY "Public read access for promises" ON public.promises FOR SELECT USING (true);
CREATE POLICY "Public read access for vocabulary" ON public.vocabulary FOR SELECT USING (true);
CREATE POLICY "Public read access for deputies" ON public.deputies FOR SELECT USING (true);
CREATE POLICY "Public read access for bills" ON public.bills FOR SELECT USING (true);
CREATE POLICY "Public read access for votes" ON public.votes FOR SELECT USING (true);
CREATE POLICY "Public read access for laws" ON public.laws FOR SELECT USING (true);

-- Admin read/write logic for generic content tables
CREATE POLICY "Admin full access for content" ON public.content FOR ALL USING (is_admin());
CREATE POLICY "Admin full access for events" ON public.events FOR ALL USING (is_admin());
CREATE POLICY "Admin full access for politicians" ON public.politicians FOR ALL USING (is_admin());
CREATE POLICY "Admin full access for promises" ON public.promises FOR ALL USING (is_admin());
CREATE POLICY "Admin full access for vocabulary" ON public.vocabulary FOR ALL USING (is_admin());
CREATE POLICY "Admin full access for deputies" ON public.deputies FOR ALL USING (is_admin());
CREATE POLICY "Admin full access for bills" ON public.bills FOR ALL USING (is_admin());
CREATE POLICY "Admin full access for votes" ON public.votes FOR ALL USING (is_admin());
CREATE POLICY "Admin full access for laws" ON public.laws FOR ALL USING (is_admin());

-- Subscribers / Newsletter (Users only manage their own)
CREATE POLICY "Users can manage own subscriber row" ON public.subscribers
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own newsletter editions" ON public.newsletter_editions
  FOR ALL USING (
    auth.uid() = (SELECT user_id FROM public.subscribers WHERE id = subscriber_id)
  );

-- Admin Config & Pipeline Logs (Admin read/write)
CREATE POLICY "Admin full access for admin_config" ON public.admin_config FOR ALL USING (is_admin());
CREATE POLICY "Admin full access for pipeline_logs" ON public.pipeline_logs FOR ALL USING (is_admin());
