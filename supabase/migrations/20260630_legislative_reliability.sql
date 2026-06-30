-- Canonical legislative model. Facts come from official records; generated text is isolated.
BEGIN;

CREATE TYPE public.legislative_category AS ENUM (
  'economy_finance', 'social_labour', 'health', 'education_culture',
  'environment_agriculture', 'justice_security', 'institutions',
  'defence_international', 'territories_housing', 'other'
);

CREATE TABLE public.legislative_dossiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  official_id TEXT NOT NULL UNIQUE,
  legislature INTEGER NOT NULL DEFAULT 17 CHECK (legislature > 0),
  title TEXT NOT NULL,
  short_title TEXT,
  text_type TEXT NOT NULL CHECK (text_type IN ('bill', 'proposal')),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('government', 'parliamentarian')),
  author_name TEXT,
  author_official_ids TEXT[] NOT NULL DEFAULT '{}',
  category public.legislative_category NOT NULL DEFAULT 'other',
  status_code TEXT NOT NULL DEFAULT 'filed',
  status_label TEXT NOT NULL DEFAULT 'Déposé',
  current_chamber TEXT CHECK (current_chamber IN ('AN', 'SENAT', 'CMP', 'CC', 'JORF')),
  deposited_at DATE,
  latest_step_at TIMESTAMPTZ,
  source_urls TEXT[] NOT NULL DEFAULT '{}',
  source_updated_at TIMESTAMPTZ NOT NULL,
  source_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.legislative_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  official_id TEXT NOT NULL UNIQUE,
  dossier_id UUID NOT NULL REFERENCES public.legislative_dossiers(id) ON DELETE CASCADE,
  chamber TEXT NOT NULL CHECK (chamber IN ('AN', 'SENAT', 'CMP', 'CC', 'JORF')),
  step_code TEXT NOT NULL,
  step_label TEXT NOT NULL,
  occurred_at TIMESTAMPTZ,
  sequence INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  source_hash TEXT NOT NULL,
  UNIQUE (dossier_id, sequence)
);

CREATE TABLE public.legislative_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  official_id TEXT NOT NULL UNIQUE,
  dossier_id UUID NOT NULL REFERENCES public.legislative_dossiers(id) ON DELETE CASCADE,
  step_id UUID REFERENCES public.legislative_steps(id) ON DELETE SET NULL,
  chamber TEXT NOT NULL CHECK (chamber IN ('AN', 'SENAT')),
  number TEXT NOT NULL,
  author_name TEXT,
  author_official_ids TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT,
  body TEXT,
  outcome_code TEXT CHECK (outcome_code IN ('adopted', 'rejected', 'withdrawn', 'not_defended', 'pending')),
  outcome_label TEXT,
  voted_at TIMESTAMPTZ,
  source_url TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  source_hash TEXT NOT NULL
);

CREATE TABLE public.legislative_scrutins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  official_id TEXT NOT NULL UNIQUE,
  dossier_id UUID NOT NULL REFERENCES public.legislative_dossiers(id) ON DELETE CASCADE,
  step_id UUID REFERENCES public.legislative_steps(id) ON DELETE SET NULL,
  amendment_id UUID REFERENCES public.legislative_amendments(id) ON DELETE SET NULL,
  chamber TEXT NOT NULL CHECK (chamber IN ('AN', 'SENAT')),
  title TEXT NOT NULL,
  result_code TEXT,
  result_label TEXT,
  for_count INTEGER NOT NULL DEFAULT 0,
  against_count INTEGER NOT NULL DEFAULT 0,
  abstain_count INTEGER NOT NULL DEFAULT 0,
  voted_at TIMESTAMPTZ NOT NULL,
  source_url TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  source_hash TEXT NOT NULL
);

CREATE TABLE public.legislative_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrutin_id UUID NOT NULL REFERENCES public.legislative_scrutins(id) ON DELETE CASCADE,
  voter_official_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  group_code TEXT,
  position TEXT NOT NULL CHECK (position IN ('for', 'against', 'abstain', 'non_voting')),
  UNIQUE (scrutin_id, voter_official_id)
);

CREATE TABLE public.legislative_group_results (
  scrutin_id UUID NOT NULL REFERENCES public.legislative_scrutins(id) ON DELETE CASCADE,
  group_code TEXT NOT NULL,
  group_name TEXT,
  for_count INTEGER NOT NULL DEFAULT 0,
  against_count INTEGER NOT NULL DEFAULT 0,
  abstain_count INTEGER NOT NULL DEFAULT 0,
  non_voting_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scrutin_id, group_code)
);

CREATE TABLE public.promulgated_laws (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id UUID NOT NULL UNIQUE REFERENCES public.legislative_dossiers(id) ON DELETE CASCADE,
  jorf_id TEXT NOT NULL UNIQUE,
  nor TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  promulgated_at DATE NOT NULL,
  eli_url TEXT,
  source_url TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  source_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.legislative_source_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('AN', 'SENAT', 'DILA', 'DATAGOUV')),
  record_type TEXT NOT NULL,
  official_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_hash TEXT NOT NULL,
  raw_excerpt JSONB,
  UNIQUE (provider, record_type, official_id, source_hash)
);

CREATE TABLE public.legislative_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id UUID NOT NULL REFERENCES public.legislative_dossiers(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('public', 'premium')),
  summary TEXT NOT NULL,
  source_urls TEXT[] NOT NULL,
  input_hash TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dossier_id, audience, input_hash, prompt_version)
);

CREATE TABLE public.legislative_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  processed_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX legislative_dossiers_listing_idx ON public.legislative_dossiers (latest_step_at DESC, official_id);
CREATE INDEX promulgated_laws_listing_idx ON public.promulgated_laws (promulgated_at DESC, jorf_id);
CREATE INDEX legislative_steps_dossier_idx ON public.legislative_steps (dossier_id, sequence);
CREATE INDEX legislative_amendments_dossier_idx ON public.legislative_amendments (dossier_id, voted_at DESC);
CREATE INDEX legislative_scrutins_dossier_idx ON public.legislative_scrutins (dossier_id, voted_at DESC);

ALTER TABLE public.legislative_dossiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legislative_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legislative_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legislative_scrutins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legislative_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legislative_group_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promulgated_laws ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legislative_source_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legislative_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legislative_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read dossiers" ON public.legislative_dossiers FOR SELECT USING (true);
CREATE POLICY "Public read steps" ON public.legislative_steps FOR SELECT USING (true);
CREATE POLICY "Public read amendments" ON public.legislative_amendments FOR SELECT USING (true);
CREATE POLICY "Public read scrutins" ON public.legislative_scrutins FOR SELECT USING (true);
CREATE POLICY "Public read votes" ON public.legislative_votes FOR SELECT USING (true);
CREATE POLICY "Public read group results" ON public.legislative_group_results FOR SELECT USING (true);
CREATE POLICY "Public read promulgated laws" ON public.promulgated_laws FOR SELECT USING (true);
CREATE POLICY "Public read analyses only" ON public.legislative_analyses FOR SELECT USING (audience = 'public');

GRANT SELECT ON public.legislative_dossiers, public.legislative_steps,
  public.legislative_amendments, public.legislative_scrutins,
  public.legislative_votes, public.legislative_group_results,
  public.promulgated_laws, public.legislative_analyses TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.has_premium_access()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
      OR EXISTS (SELECT 1 FROM subscribers WHERE user_id = auth.uid() AND status IN ('active', 'trial'));
$$;

CREATE POLICY "Members read premium analyses" ON public.legislative_analyses
  FOR SELECT USING (audience = 'public' OR public.has_premium_access());

DO $$
BEGIN
  IF to_regclass('public.laws') IS NOT NULL AND to_regclass('public.legacy_laws') IS NULL THEN
    ALTER TABLE public.laws RENAME TO legacy_laws;
  END IF;
END $$;

REVOKE ALL ON public.legacy_laws FROM anon, authenticated;

CREATE VIEW public.laws WITH (security_invoker = true) AS
SELECT
  d.id,
  d.title,
  a.summary,
  d.status_label AS context,
  NULL::text AS content,
  NULL::text AS impact,
  p.promulgated_at AS date_adopted,
  d.category::text AS category,
  (SELECT jsonb_agg(jsonb_build_object('label', s.step_label, 'date', s.occurred_at, 'chamber', s.chamber) ORDER BY s.sequence)
     FROM public.legislative_steps s WHERE s.dossier_id = d.id) AS timeline,
  NULL::text AS vote_result,
  d.source_urls,
  d.created_at,
  d.author_name AS author
FROM public.legislative_dossiers d
LEFT JOIN public.promulgated_laws p ON p.dossier_id = d.id
LEFT JOIN LATERAL (
  SELECT summary FROM public.legislative_analyses
  WHERE dossier_id = d.id AND audience = 'public'
  ORDER BY generated_at DESC LIMIT 1
) a ON true;
GRANT SELECT ON public.laws TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_promulgated_laws(
  p_category TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_cursor_date DATE DEFAULT NULL,
  p_cursor_id TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
) RETURNS TABLE (
  id UUID, official_id TEXT, title TEXT, category TEXT, status_code TEXT, status_label TEXT,
  author_name TEXT, promulgated_at DATE, jorf_id TEXT, nor TEXT, source_urls TEXT[],
  source_updated_at TIMESTAMPTZ, data_freshness INTERVAL, summary TEXT
) LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT d.id, d.official_id, d.title, d.category::text, 'promulgated', 'Promulguée', d.author_name,
         p.promulgated_at, p.jorf_id, p.nor, array_append(d.source_urls, p.source_url),
         GREATEST(d.source_updated_at, p.source_updated_at), now() - GREATEST(d.source_updated_at, p.source_updated_at), a.summary
  FROM promulgated_laws p
  JOIN legislative_dossiers d ON d.id = p.dossier_id
  LEFT JOIN LATERAL (SELECT la.summary FROM legislative_analyses la WHERE la.dossier_id=d.id AND la.audience='public' ORDER BY la.generated_at DESC LIMIT 1) a ON true
  WHERE (p_category IS NULL OR d.category::text = p_category)
    AND (p_search IS NULL OR d.title ILIKE '%' || p_search || '%')
    AND (p_cursor_date IS NULL OR (p.promulgated_at, p.jorf_id) < (p_cursor_date, COALESCE(p_cursor_id, '')))
  ORDER BY p.promulgated_at DESC, p.jorf_id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.public_legislative_dossiers(
  p_status TEXT DEFAULT NULL,
  p_chamber TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_cursor_date TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
) RETURNS TABLE (
  id UUID, official_id TEXT, title TEXT, text_type TEXT, category TEXT, status_code TEXT,
  status_label TEXT, current_chamber TEXT, author_name TEXT, latest_step_at TIMESTAMPTZ,
  cursor_date TIMESTAMPTZ, source_urls TEXT[], source_updated_at TIMESTAMPTZ, data_freshness INTERVAL, summary TEXT
) LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT d.id, d.official_id, d.title, d.text_type, d.category::text, d.status_code, d.status_label,
         d.current_chamber, d.author_name, d.latest_step_at, COALESCE(d.latest_step_at, d.created_at), d.source_urls, d.source_updated_at,
         now() - d.source_updated_at, a.summary
  FROM legislative_dossiers d
  LEFT JOIN promulgated_laws p ON p.dossier_id = d.id
  LEFT JOIN LATERAL (SELECT la.summary FROM legislative_analyses la WHERE la.dossier_id=d.id AND la.audience='public' ORDER BY la.generated_at DESC LIMIT 1) a ON true
  WHERE p.id IS NULL
    AND (p_status IS NULL OR d.status_code = p_status)
    AND (p_chamber IS NULL OR d.current_chamber = p_chamber)
    AND (p_category IS NULL OR d.category::text = p_category)
    AND (p_search IS NULL OR d.title ILIKE '%' || p_search || '%')
    AND (p_cursor_date IS NULL OR (COALESCE(d.latest_step_at, d.created_at), d.official_id) < (p_cursor_date, COALESCE(p_cursor_id, '')))
  ORDER BY COALESCE(d.latest_step_at, d.created_at) DESC, d.official_id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.public_legislative_dossier(p_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT jsonb_build_object(
    'dossier', to_jsonb(d),
    'promulgation', to_jsonb(p),
    'summary', (SELECT to_jsonb(a) FROM legislative_analyses a WHERE a.dossier_id=d.id AND a.audience='public' ORDER BY a.generated_at DESC LIMIT 1),
    'premium_analysis', (SELECT to_jsonb(a) FROM legislative_analyses a WHERE a.dossier_id=d.id AND a.audience='premium' AND public.has_premium_access() ORDER BY a.generated_at DESC LIMIT 1),
    'steps', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sequence) FROM legislative_steps s WHERE s.dossier_id=d.id), '[]'::jsonb),
    'amendments', COALESCE((SELECT jsonb_agg(to_jsonb(am) ORDER BY am.voted_at DESC NULLS LAST) FROM legislative_amendments am WHERE am.dossier_id=d.id), '[]'::jsonb),
    'scrutins', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(sc) || jsonb_build_object(
          'group_results', COALESCE((SELECT jsonb_agg(to_jsonb(gr) ORDER BY gr.group_code) FROM legislative_group_results gr WHERE gr.scrutin_id=sc.id), '[]'::jsonb),
          'votes', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.voter_name) FROM legislative_votes v WHERE v.scrutin_id=sc.id), '[]'::jsonb)
        ) ORDER BY sc.voted_at DESC
      ) FROM legislative_scrutins sc WHERE sc.dossier_id=d.id
    ), '[]'::jsonb)
  ) FROM legislative_dossiers d LEFT JOIN promulgated_laws p ON p.dossier_id=d.id WHERE d.id=p_id;
$$;

GRANT EXECUTE ON FUNCTION public.public_promulgated_laws(TEXT,TEXT,DATE,TEXT,INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_legislative_dossiers(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_legislative_dossier(UUID) TO anon, authenticated;

COMMIT;
