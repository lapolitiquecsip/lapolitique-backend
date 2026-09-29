-- ─────────────────────────────────────────────────────────────────────────────
-- Analyse approfondie d'un texte de loi, et le cadre législatif qui existe déjà.
--
-- L'analyse « premium » d'un dossier (legislative_analyses) ne décrivait que la
-- PROCÉDURE — dépôt, commission, séance — faute d'accès au contenu. Celle-ci est
-- écrite à partir du TEXTE LUI-MÊME (texte adopté, exposé des motifs, étude
-- d'impact, en PDF sur le site de l'Assemblée) : chaque mesure, ce qui existait
-- avant et ce qui change, les chiffres, qui est concerné, quand ça s'applique.
-- Le « cadre existant » dit ce que prévoit déjà le droit dans le même domaine.
--
-- Écrite par src/scripts/legislative/analyse-approfondie.ts.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.dossier_analyses_approfondies (
  dossier_id uuid primary key references public.legislative_dossiers(id) on delete cascade,
  -- { en_une_phrase, contexte, mesures:[{titre, article, avant, apres, detail, qui}],
  --   chiffres_cles:[{valeur, libelle}], concernes:[{public, effet}], calendrier:[…],
  --   financement, sanctions:[…], apports_parlement, points_debat:[…], limites }
  analyse_loi jsonb not null,
  -- { synthese, dispositifs:[{nom, description, reference}], chiffres:[…],
  --   fiches:[{titre, url}], textes:[{titre, url}] }
  cadre jsonb,
  -- Les documents lus : [{ titre, url }]
  sources jsonb not null default '[]'::jsonb,
  -- Le texte analysé (ex. « l17t0338 ») : un texte plus récent relance l'analyse.
  texte_version text,
  model text,
  generated_at timestamptz not null default now()
);

alter table public.dossier_analyses_approfondies enable row level security;

-- Réservé aux abonnés, dans la base et pas seulement à l'affichage.
drop policy if exists "lecture abonnes" on public.dossier_analyses_approfondies;
create policy "lecture abonnes" on public.dossier_analyses_approfondies
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_premium = true or coalesce(p.subscription_tier, 'free') in ('elite', 'pro'))
    )
  );

-- Ce qu'un non-abonné a le droit de savoir : QU'une analyse existe, et son
-- ampleur (« 14 mesures détaillées »), pour lui montrer ce qu'il manque — jamais
-- son contenu.
create or replace function public.public_analyse_apercu(p_dossier_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'mesures', coalesce(jsonb_array_length(a.analyse_loi->'mesures'), 0),
    'chiffres', coalesce(jsonb_array_length(a.analyse_loi->'chiffres_cles'), 0),
    'cadre', a.cadre is not null,
    'generated_at', a.generated_at
  )
  from public.dossier_analyses_approfondies a
  where a.dossier_id = p_dossier_id;
$$;

grant execute on function public.public_analyse_apercu(uuid) to anon, authenticated;

-- Le dossier d'un vote : l'identifiant d'un scrutin de l'Assemblée (VTANR5L17V…)
-- est aussi celui de sa ligne dans legislative_scrutins, qui porte le dossier.
create or replace function public.public_dossier_du_scrutin(p_scrutin text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select dossier_id from public.legislative_scrutins where official_id = p_scrutin and dossier_id is not null limit 1;
$$;

grant execute on function public.public_dossier_du_scrutin(text) to anon, authenticated;
