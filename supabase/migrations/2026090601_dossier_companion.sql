-- Fiche loi : agréger les votes/amendements du dossier « frère » (autre chambre).
--
-- Problème : une même loi vit dans DEUX dossiers séparés (Assemblée + Sénat, la « navette »).
-- La loi promulguée est souvent reliée au dossier d'UNE chambre qui n'a pas les scrutins, alors
-- que le dossier frère (l'autre chambre) porte les 296 scrutins (ex. LPM). D'où « aucun vote »
-- affiché alors que la loi a bien été votée. 77 lois promulguées sont dans ce cas, 40 réparables.
--
-- Solution : un pointeur companion_dossier_id vers le dossier frère (rempli hors-ligne par
-- appariement strict de titre), et le RPC de détail agrège scrutins + amendements des DEUX.

ALTER TABLE public.legislative_dossiers
  ADD COLUMN IF NOT EXISTS companion_dossier_id UUID REFERENCES public.legislative_dossiers(id) ON DELETE SET NULL;

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
    -- Amendements : dossier + frère, 300 plus récents + total réel.
    'amendments', COALESCE((
      SELECT jsonb_agg(to_jsonb(am) ORDER BY am.voted_at DESC NULLS LAST)
      FROM (SELECT * FROM legislative_amendments WHERE dossier_id = d.id OR dossier_id = d.companion_dossier_id ORDER BY voted_at DESC NULLS LAST LIMIT 300) am
    ), '[]'::jsonb),
    'amendments_total', (SELECT count(*) FROM legislative_amendments WHERE dossier_id = d.id OR dossier_id = d.companion_dossier_id),
    -- Scrutins : dossier + frère, 40 plus récents, résultats par groupe + nombre de votes nominatifs.
    'scrutins', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(sc) || jsonb_build_object(
          'group_results', COALESCE((SELECT jsonb_agg(to_jsonb(gr) ORDER BY gr.group_code) FROM legislative_group_results gr WHERE gr.scrutin_id=sc.id), '[]'::jsonb),
          'votes_count', (SELECT count(*) FROM legislative_votes v WHERE v.scrutin_id=sc.id)
        ) ORDER BY sc.voted_at DESC
      )
      FROM (SELECT * FROM legislative_scrutins WHERE dossier_id = d.id OR dossier_id = d.companion_dossier_id ORDER BY voted_at DESC LIMIT 40) sc
    ), '[]'::jsonb),
    'scrutins_total', (SELECT count(*) FROM legislative_scrutins WHERE dossier_id = d.id OR dossier_id = d.companion_dossier_id)
  ) FROM legislative_dossiers d LEFT JOIN promulgated_laws p ON p.dossier_id=d.id WHERE d.id=p_id;
$$;

GRANT EXECUTE ON FUNCTION public.public_legislative_dossier(UUID) TO anon, authenticated;
