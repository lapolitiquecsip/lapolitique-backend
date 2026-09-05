-- Fiche loi : borne le RPC de détail pour ne plus dépasser le statement_timeout de l'anon.
--
-- Problème : public_legislative_dossier agrégeait TOUS les amendements + TOUS les scrutins avec
-- TOUS les votes nominatifs d'un dossier. Pour les gros textes (aide à mourir : 2 295 amendements,
-- 960 scrutins ≈ ~500 000 votes ; PLFSS : 2 297 amendements, 558 scrutins), le JSONB était
-- gigantesque → « canceling statement due to statement timeout » → fiche vide (clic mort).
--
-- Correctif :
--   • amendements plafonnés aux 300 plus récents (+ total réel) ;
--   • scrutins plafonnés aux 40 plus récents, SANS les votes nominatifs en ligne mais avec
--     leur nombre (votes_count) et les résultats par groupe (+ total réel) ;
--   • votes nominatifs déportés dans public_scrutin_votes(scrutin) chargé À LA DEMANDE ;
--   • statement_timeout local relevé en filet de sécurité.

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
    -- Amendements : 300 plus récents (la fiche pagine côté client) + total réel.
    'amendments', COALESCE((
      SELECT jsonb_agg(to_jsonb(am) ORDER BY am.voted_at DESC NULLS LAST)
      FROM (SELECT * FROM legislative_amendments WHERE dossier_id=d.id ORDER BY voted_at DESC NULLS LAST LIMIT 300) am
    ), '[]'::jsonb),
    'amendments_total', (SELECT count(*) FROM legislative_amendments WHERE dossier_id=d.id),
    -- Scrutins : 40 plus récents, résultats par groupe + nombre de votes nominatifs (pas la liste).
    'scrutins', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(sc) || jsonb_build_object(
          'group_results', COALESCE((SELECT jsonb_agg(to_jsonb(gr) ORDER BY gr.group_code) FROM legislative_group_results gr WHERE gr.scrutin_id=sc.id), '[]'::jsonb),
          'votes_count', (SELECT count(*) FROM legislative_votes v WHERE v.scrutin_id=sc.id)
        ) ORDER BY sc.voted_at DESC
      )
      FROM (SELECT * FROM legislative_scrutins WHERE dossier_id=d.id ORDER BY voted_at DESC LIMIT 40) sc
    ), '[]'::jsonb),
    'scrutins_total', (SELECT count(*) FROM legislative_scrutins WHERE dossier_id=d.id)
  ) FROM legislative_dossiers d LEFT JOIN promulgated_laws p ON p.dossier_id=d.id WHERE d.id=p_id;
$$;

GRANT EXECUTE ON FUNCTION public.public_legislative_dossier(UUID) TO anon, authenticated;

-- Votes nominatifs d'UN scrutin, chargés à la demande (quand l'utilisateur déplie « Votes nominatifs »).
CREATE OR REPLACE FUNCTION public.public_scrutin_votes(p_scrutin_id UUID)
RETURNS TABLE (voter_official_id TEXT, voter_name TEXT, group_code TEXT, "position" TEXT)
LANGUAGE sql STABLE SECURITY INVOKER
SET statement_timeout = '10s'
AS $$
  SELECT v.voter_official_id, v.voter_name, v.group_code, v.position
  FROM legislative_votes v
  WHERE v.scrutin_id = p_scrutin_id
  ORDER BY v.voter_name;
$$;

GRANT EXECUTE ON FUNCTION public.public_scrutin_votes(UUID) TO anon, authenticated;
