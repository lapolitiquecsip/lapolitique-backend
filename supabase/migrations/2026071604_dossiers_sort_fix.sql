-- Fix tri « navette parlementaire » : la dernière étape (latest_step_at) inclut des
-- étapes FUTURES programmées (réunions de commission à venir) → elles remontaient
-- au-dessus des lois réellement votées récemment. On plafonne la date de tri à now().

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
         d.current_chamber, d.author_name, d.latest_step_at,
         LEAST(COALESCE(d.latest_step_at, d.created_at), now()) AS cursor_date,
         d.source_urls, d.source_updated_at,
         now() - d.source_updated_at, a.summary
  FROM legislative_dossiers d
  LEFT JOIN promulgated_laws p ON p.dossier_id = d.id
  LEFT JOIN LATERAL (SELECT la.summary FROM legislative_analyses la WHERE la.dossier_id=d.id AND la.audience='public' ORDER BY la.generated_at DESC LIMIT 1) a ON true
  WHERE p.id IS NULL
    AND (p_status IS NULL OR d.status_code = p_status)
    AND (p_chamber IS NULL OR d.current_chamber = p_chamber)
    AND (p_category IS NULL OR d.category::text = p_category)
    AND (p_search IS NULL OR d.title ILIKE '%' || p_search || '%')
    AND (p_cursor_date IS NULL OR (LEAST(COALESCE(d.latest_step_at, d.created_at), now()), d.official_id) < (p_cursor_date, COALESCE(p_cursor_id, '')))
  ORDER BY LEAST(COALESCE(d.latest_step_at, d.created_at), now()) DESC, d.official_id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;
