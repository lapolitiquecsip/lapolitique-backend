-- Fiche loi : ouverture INSTANTANÉE. On retire les gros tableaux (amendements/scrutins, jusqu'à
-- 1,8 Mo de JSONB) du RPC de détail : ils sont derrière des boutons « Voir » repliés, donc chargés
-- À LA DEMANDE via deux RPC dédiés. Le détail ne renvoie plus que le léger (dossier, résumé,
-- analyse, navette) + les compteurs. Les deux RPC de détail agrègent toujours le dossier frère.

CREATE OR REPLACE FUNCTION public.public_legislative_dossier(p_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER
SET statement_timeout = '12s'
AS $$
  SELECT jsonb_build_object(
    'dossier', to_jsonb(d),
    'promulgation', to_jsonb(p),
    'summary', (SELECT to_jsonb(a) FROM legislative_analyses a WHERE a.dossier_id=d.id AND a.audience='public' ORDER BY a.generated_at DESC LIMIT 1),
    'premium_analysis', (SELECT to_jsonb(a) FROM legislative_analyses a WHERE a.dossier_id=d.id AND a.audience='premium' AND public.has_premium_access() ORDER BY a.generated_at DESC LIMIT 1),
    'steps', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sequence) FROM legislative_steps s WHERE s.dossier_id=d.id), '[]'::jsonb),
    'amendments_total', (SELECT count(*) FROM legislative_amendments WHERE dossier_id = d.id OR dossier_id = d.companion_dossier_id),
    'scrutins_total', (SELECT count(*) FROM legislative_scrutins WHERE dossier_id = d.id OR dossier_id = d.companion_dossier_id)
  ) FROM legislative_dossiers d LEFT JOIN promulgated_laws p ON p.dossier_id=d.id WHERE d.id=p_id;
$$;
GRANT EXECUTE ON FUNCTION public.public_legislative_dossier(UUID) TO anon, authenticated;

-- Amendements d'une loi (dossier + frère), 300 plus récents, chargés au dépliage.
CREATE OR REPLACE FUNCTION public.public_dossier_amendments(p_id UUID)
RETURNS TABLE (official_id TEXT, number TEXT, author_name TEXT, subject TEXT, body TEXT, outcome_label TEXT, chamber TEXT, voted_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY INVOKER
SET statement_timeout = '12s'
AS $$
  SELECT am.official_id, am.number, am.author_name, am.subject, am.body, am.outcome_label, am.chamber, am.voted_at
  FROM legislative_amendments am
  JOIN legislative_dossiers d ON d.id = p_id
  WHERE am.dossier_id = d.id OR am.dossier_id = d.companion_dossier_id
  ORDER BY am.voted_at DESC NULLS LAST
  LIMIT 300;
$$;
GRANT EXECUTE ON FUNCTION public.public_dossier_amendments(UUID) TO anon, authenticated;

-- Scrutins d'une loi (dossier + frère), 60 plus récents, avec résultats par groupe + nombre de
-- votes nominatifs. Chargés au dépliage.
CREATE OR REPLACE FUNCTION public.public_dossier_scrutins(p_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER
SET statement_timeout = '12s'
AS $$
  SELECT COALESCE(jsonb_agg(
    to_jsonb(sc) || jsonb_build_object(
      'group_results', COALESCE((SELECT jsonb_agg(to_jsonb(gr) ORDER BY gr.group_code) FROM legislative_group_results gr WHERE gr.scrutin_id=sc.id), '[]'::jsonb),
      'votes_count', (SELECT count(*) FROM legislative_votes v WHERE v.scrutin_id=sc.id)
    ) ORDER BY sc.voted_at DESC
  ), '[]'::jsonb)
  FROM (
    SELECT s.* FROM legislative_scrutins s JOIN legislative_dossiers d ON d.id = p_id
    WHERE s.dossier_id = d.id OR s.dossier_id = d.companion_dossier_id
    ORDER BY s.voted_at DESC LIMIT 60
  ) sc;
$$;
GRANT EXECUTE ON FUNCTION public.public_dossier_scrutins(UUID) TO anon, authenticated;
