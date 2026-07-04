-- Canonical cross-domain data platform. Official facts are writable only with the service role.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  domain text NOT NULL,
  producer text NOT NULL,
  dataset_name text NOT NULL,
  dataset_url text NOT NULL,
  licence text,
  expected_frequency interval,
  expected_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.data_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
  official_id text NOT NULL,
  resource_url text NOT NULL,
  format text NOT NULL,
  reference_year integer,
  published_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  content_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_id, official_id, content_hash)
);

CREATE TABLE IF NOT EXISTS public.ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  job_name text NOT NULL,
  mode text NOT NULL DEFAULT 'incremental' CHECK (mode IN ('incremental', 'backfill', 'dry-run', 'reconcile')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed', 'partial', 'skipped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  source_id uuid REFERENCES public.data_sources(id),
  resource_id uuid REFERENCES public.data_resources(id),
  rows_read integer NOT NULL DEFAULT 0,
  rows_written integer NOT NULL DEFAULT 0,
  rows_rejected integer NOT NULL DEFAULT 0,
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ingestion_runs_job_started_idx ON public.ingestion_runs(job_name, started_at DESC);

CREATE TABLE IF NOT EXISTS public.data_quality_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.ingestion_runs(id) ON DELETE SET NULL,
  domain text NOT NULL,
  issue_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  official_id text,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.territories (
  code text PRIMARY KEY,
  official_id text UNIQUE NOT NULL,
  type text NOT NULL CHECK (type IN ('commune', 'department', 'region')),
  name text NOT NULL,
  parent_department_code text REFERENCES public.territories(code),
  parent_region_code text REFERENCES public.territories(code),
  area_km2 numeric,
  source_id uuid REFERENCES public.data_sources(id),
  source_updated_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  quality_status text NOT NULL DEFAULT 'verified' CHECK (quality_status IN ('verified', 'partial', 'stale', 'rejected'))
);
CREATE INDEX IF NOT EXISTS territories_type_name_idx ON public.territories(type, name);

CREATE TABLE IF NOT EXISTS public.territory_indicators (
  territory_code text NOT NULL REFERENCES public.territories(code) ON DELETE CASCADE,
  indicator_code text NOT NULL,
  domain text NOT NULL,
  value numeric,
  unit text NOT NULL,
  reference_year integer NOT NULL,
  methodology_version text NOT NULL DEFAULT 'official-v1',
  raw_components jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_id uuid NOT NULL REFERENCES public.data_sources(id),
  source_urls text[] NOT NULL DEFAULT '{}',
  source_updated_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  quality_status text NOT NULL DEFAULT 'verified' CHECK (quality_status IN ('verified', 'partial', 'stale', 'rejected')),
  PRIMARY KEY (territory_code, indicator_code, reference_year, source_id)
);
CREATE INDEX IF NOT EXISTS territory_indicators_lookup_idx ON public.territory_indicators(territory_code, domain, reference_year DESC);

CREATE TABLE IF NOT EXISTS public.senators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  official_id text UNIQUE NOT NULL,
  slug text UNIQUE NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  group_name text,
  party text,
  department text,
  department_code text,
  photo_url text,
  photo_source_url text,
  photo_licence text,
  biography text,
  legal_issues text,
  source_urls text[] NOT NULL DEFAULT '{}',
  source_updated_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  quality_status text NOT NULL DEFAULT 'verified'
);

CREATE TABLE IF NOT EXISTS public.elected_officials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  official_id text UNIQUE NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  sex text,
  birth_date date,
  source_id uuid NOT NULL REFERENCES public.data_sources(id),
  source_urls text[] NOT NULL DEFAULT '{}',
  source_updated_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  quality_status text NOT NULL DEFAULT 'verified'
);

CREATE TABLE IF NOT EXISTS public.elected_mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  official_id text UNIQUE NOT NULL,
  official_id_person text NOT NULL REFERENCES public.elected_officials(official_id) ON DELETE CASCADE,
  mandate_type text NOT NULL,
  territory_code text REFERENCES public.territories(code),
  institution text,
  group_name text,
  started_at date,
  ended_at date,
  source_id uuid NOT NULL REFERENCES public.data_sources(id),
  source_updated_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS elected_mandates_lookup_idx ON public.elected_mandates(territory_code, mandate_type, ended_at);

CREATE TABLE IF NOT EXISTS public.governments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  official_id text UNIQUE NOT NULL,
  name text NOT NULL,
  prime_minister text NOT NULL,
  started_at date NOT NULL,
  ended_at date,
  source_urls text[] NOT NULL DEFAULT '{}',
  source_updated_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ministries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  official_id text UNIQUE NOT NULL,
  name text NOT NULL,
  website_url text,
  source_urls text[] NOT NULL DEFAULT '{}',
  source_updated_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.government_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  official_id text UNIQUE NOT NULL,
  government_id uuid NOT NULL REFERENCES public.governments(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES public.ministries(id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  title text NOT NULL,
  rank integer,
  started_at date NOT NULL,
  ended_at date,
  photo_url text,
  source_urls text[] NOT NULL DEFAULT '{}',
  source_updated_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.state_budget_missions (
  official_id text NOT NULL,
  fiscal_year integer NOT NULL,
  name text NOT NULL,
  amount numeric NOT NULL,
  amount_type text NOT NULL CHECK (amount_type IN ('project', 'voted', 'executed', 'forecast')),
  source_urls text[] NOT NULL DEFAULT '{}',
  source_updated_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  quality_status text NOT NULL DEFAULT 'verified',
  PRIMARY KEY (official_id, fiscal_year, amount_type)
);
CREATE TABLE IF NOT EXISTS public.state_budget_programs (
  official_id text NOT NULL,
  mission_official_id text NOT NULL,
  fiscal_year integer NOT NULL,
  name text NOT NULL,
  amount numeric NOT NULL,
  amount_type text NOT NULL CHECK (amount_type IN ('project', 'voted', 'executed', 'forecast')),
  source_urls text[] NOT NULL DEFAULT '{}',
  source_updated_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (official_id, fiscal_year, amount_type)
);
CREATE TABLE IF NOT EXISTS public.national_finance_indicators (
  indicator_code text NOT NULL,
  reference_year integer NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('project', 'voted', 'executed', 'forecast', 'observed')),
  source_urls text[] NOT NULL DEFAULT '{}',
  source_updated_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (indicator_code, reference_year, value_type)
);

CREATE TABLE IF NOT EXISTS public.elections (
  official_id text PRIMARY KEY,
  name text NOT NULL,
  election_type text NOT NULL,
  round_count integer NOT NULL,
  first_round_date date,
  source_urls text[] NOT NULL DEFAULT '{}',
  source_updated_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.election_results (
  election_official_id text NOT NULL REFERENCES public.elections(official_id) ON DELETE CASCADE,
  round integer NOT NULL,
  territory_code text NOT NULL,
  candidate_official_id text NOT NULL DEFAULT '',
  candidate_name text,
  list_name text,
  nuance_code text,
  registered integer,
  voters integer,
  expressed integer,
  votes integer,
  elected boolean NOT NULL DEFAULT false,
  source_urls text[] NOT NULL DEFAULT '{}',
  source_updated_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  quality_status text NOT NULL DEFAULT 'verified',
  PRIMARY KEY (election_official_id, round, territory_code, candidate_official_id)
);
CREATE INDEX IF NOT EXISTS election_results_lookup_idx ON public.election_results(election_official_id, round, territory_code);

CREATE TABLE IF NOT EXISTS public.political_promises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  official_id text UNIQUE NOT NULL,
  politician_id uuid REFERENCES public.politicians(id) ON DELETE SET NULL,
  statement text NOT NULL,
  category text,
  made_at date,
  primary_source_url text NOT NULL,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.promises ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS public.promise_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promise_id uuid NOT NULL REFERENCES public.political_promises(id) ON DELETE CASCADE,
  evidence_type text NOT NULL,
  title text NOT NULL,
  source_url text NOT NULL,
  observed_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.promise_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promise_id uuid NOT NULL REFERENCES public.political_promises(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'in_progress', 'kept', 'partially_kept', 'broken', 'not_assessable')),
  justification text NOT NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  assessor_id uuid REFERENCES auth.users(id),
  published boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.editorial_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected', 'changes_requested')),
  reviewer_id uuid NOT NULL REFERENCES auth.users(id),
  notes text,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS official_id text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS collected_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'partial';
CREATE UNIQUE INDEX IF NOT EXISTS events_official_id_unique ON public.events(official_id) WHERE official_id IS NOT NULL;

ALTER TABLE public.petitions ADD COLUMN IF NOT EXISTS official_id text;
ALTER TABLE public.petitions ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;
ALTER TABLE public.petitions ADD COLUMN IF NOT EXISTS collected_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS petitions_official_id_unique ON public.petitions(official_id) WHERE official_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.data_freshness(p_collected_at timestamptz, p_expected interval DEFAULT interval '7 days')
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_collected_at IS NULL THEN 'unavailable' WHEN now() - p_collected_at <= p_expected THEN 'fresh' ELSE 'stale' END
$$;

CREATE OR REPLACE FUNCTION public.public_territory(p_code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT to_jsonb(t) || jsonb_build_object(
    'source_urls', COALESCE((SELECT array_agg(DISTINCT u) FROM public.territory_indicators i CROSS JOIN LATERAL unnest(i.source_urls) u WHERE i.territory_code=t.code), '{}'),
    'data_freshness', public.data_freshness(t.collected_at)
  ) FROM public.territories t WHERE t.code=p_code AND t.quality_status <> 'rejected'
$$;

CREATE OR REPLACE FUNCTION public.public_territory_indicators(p_code text, p_domain text DEFAULT NULL)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT to_jsonb(i) || jsonb_build_object('official_id', i.territory_code || ':' || i.indicator_code, 'data_freshness', public.data_freshness(i.collected_at))
  FROM public.territory_indicators i
  WHERE i.territory_code=p_code AND (p_domain IS NULL OR i.domain=p_domain) AND i.quality_status <> 'rejected'
  ORDER BY i.domain, i.indicator_code, i.reference_year DESC
$$;

CREATE OR REPLACE FUNCTION public.public_elected_officials(p_territory text DEFAULT NULL, p_mandate text DEFAULT NULL, p_cursor uuid DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT to_jsonb(e) || jsonb_build_object('mandate', to_jsonb(m), 'data_freshness', public.data_freshness(e.collected_at))
  FROM public.elected_officials e JOIN public.elected_mandates m ON m.official_id_person=e.official_id
  WHERE (p_territory IS NULL OR m.territory_code=p_territory) AND (p_mandate IS NULL OR m.mandate_type=p_mandate) AND (p_cursor IS NULL OR e.id>p_cursor) AND m.ended_at IS NULL
  ORDER BY e.id LIMIT LEAST(GREATEST(p_limit,1),100)
$$;

CREATE OR REPLACE FUNCTION public.public_elections(p_election text, p_round integer, p_territory text DEFAULT NULL, p_offset integer DEFAULT 0, p_limit integer DEFAULT 100)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT to_jsonb(r) || jsonb_build_object('official_id', concat_ws(':',r.election_official_id,r.round,r.territory_code,r.candidate_official_id), 'data_freshness', public.data_freshness(r.collected_at))
  FROM public.election_results r WHERE r.election_official_id=p_election AND r.round=p_round AND (p_territory IS NULL OR r.territory_code=p_territory) AND r.quality_status <> 'rejected'
  ORDER BY r.territory_code, r.votes DESC NULLS LAST OFFSET GREATEST(p_offset,0) LIMIT LEAST(GREATEST(p_limit,1),500)
$$;

CREATE OR REPLACE FUNCTION public.public_government(p_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT to_jsonb(g) || jsonb_build_object('members', COALESCE((SELECT jsonb_agg(to_jsonb(m) || jsonb_build_object('ministry_name',x.name) ORDER BY m.rank NULLS LAST) FROM public.government_members m LEFT JOIN public.ministries x ON x.id=m.ministry_id WHERE m.government_id=g.id AND m.started_at<=p_date AND (m.ended_at IS NULL OR m.ended_at>=p_date)), '[]'::jsonb), 'data_freshness', public.data_freshness(g.collected_at))
  FROM public.governments g WHERE g.started_at<=p_date AND (g.ended_at IS NULL OR g.ended_at>=p_date) ORDER BY g.started_at DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.public_state_budget(p_year integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT jsonb_build_object('official_id','state-budget-'||p_year,'reference_year',p_year,'missions',COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.amount DESC),'[]'::jsonb),'source_urls',COALESCE((SELECT array_agg(DISTINCT u) FROM public.state_budget_missions x CROSS JOIN LATERAL unnest(x.source_urls) u WHERE x.fiscal_year=p_year),'{}'))
  FROM public.state_budget_missions m WHERE m.fiscal_year=p_year
$$;

CREATE OR REPLACE FUNCTION public.public_promises(p_politician uuid DEFAULT NULL, p_status text DEFAULT NULL, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT to_jsonb(p) || jsonb_build_object('assessment',to_jsonb(a),'evidence',COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM public.promise_evidence e WHERE e.promise_id=p.id),'[]'::jsonb),'source_urls',ARRAY[p.primary_source_url])
  FROM public.political_promises p JOIN LATERAL (SELECT * FROM public.promise_assessments x WHERE x.promise_id=p.id AND x.published ORDER BY x.assessed_at DESC LIMIT 1) a ON true
  WHERE p.published AND (p_politician IS NULL OR p.politician_id=p_politician) AND (p_status IS NULL OR a.status=p_status)
    AND EXISTS (SELECT 1 FROM public.editorial_reviews r WHERE r.entity_type='political_promise' AND r.entity_id=p.id AND r.decision='approved')
  ORDER BY p.updated_at DESC OFFSET GREATEST(p_offset,0) LIMIT LEAST(GREATEST(p_limit,1),100)
$$;

CREATE OR REPLACE FUNCTION public.public_data_freshness(p_domain text DEFAULT NULL)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT jsonb_build_object('domain',s.domain,'source',s.slug,'source_url',s.dataset_url,'last_success_at',max(r.finished_at),'data_freshness',public.data_freshness(max(r.finished_at),s.expected_frequency),'quality_status',CASE WHEN count(*) FILTER (WHERE r.status='failed')>=2 THEN 'warning' ELSE 'verified' END)
  FROM public.data_sources s LEFT JOIN LATERAL (SELECT * FROM public.ingestion_runs x WHERE x.source_id=s.id ORDER BY x.started_at DESC LIMIT 2) r ON true
  WHERE s.active AND (p_domain IS NULL OR s.domain=p_domain) GROUP BY s.id
$$;

ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_quality_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.territory_indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.senators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elected_officials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elected_mandates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ministries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.government_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_budget_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_budget_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.national_finance_indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.election_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.political_promises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promise_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promise_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editorial_reviews ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['data_sources','territories','territory_indicators','senators','elected_officials','elected_mandates','governments','ministries','government_members','state_budget_missions','state_budget_programs','national_finance_indicators','elections','election_results'] LOOP
    EXECUTE format('CREATE POLICY "Public read %s" ON public.%I FOR SELECT USING (true)', table_name, table_name);
  END LOOP;
END $$;
CREATE POLICY "Public read approved promises" ON public.political_promises FOR SELECT USING (published AND EXISTS (SELECT 1 FROM public.editorial_reviews r WHERE r.entity_type='political_promise' AND r.entity_id=political_promises.id AND r.decision='approved'));
CREATE POLICY "Public read published assessments" ON public.promise_assessments FOR SELECT USING (published);
CREATE POLICY "Public read evidence for approved promises" ON public.promise_evidence FOR SELECT USING (EXISTS (SELECT 1 FROM public.political_promises p WHERE p.id=promise_id AND p.published));
CREATE POLICY "Admins manage editorial reviews" ON public.editorial_reviews FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.data_sources, public.territories, public.territory_indicators, public.senators, public.elected_officials, public.elected_mandates, public.governments, public.ministries, public.government_members, public.state_budget_missions, public.state_budget_programs, public.national_finance_indicators, public.elections, public.election_results, public.political_promises, public.promise_evidence, public.promise_assessments TO anon, authenticated;
GRANT SELECT ON public.content, public.events, public.politicians, public.vocabulary, public.deputies, public.petitions TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.public_territory(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_territory_indicators(text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_elected_officials(text,text,uuid,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_elections(text,integer,text,integer,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_government(date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_state_budget(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_promises(uuid,text,integer,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_data_freshness(text) TO anon, authenticated;
