-- ─────────────────────────────────────────────────────────────────────────────
-- Niches parlementaires de l'Assemblée nationale (22/11/2026).
--
-- Une « niche » est le jour de séance mensuel dont l'ordre du jour est fixé par un
-- groupe d'opposition ou minoritaire (article 48, alinéa 5, de la Constitution).
-- Repérées dans l'agenda officiel de l'Assemblée, avec le sort de chaque texte lu
-- dans les dossiers législatifs (src/scripts/legislative/niches-parlementaires.ts).
--
-- niches_parlementaires : public (ce que dit l'agenda officiel).
-- niches_analyses       : l'analyse détaillée, réservée aux abonnés Premium et Pro.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.niches_parlementaires (
  jour date primary key,
  session text not null,                 -- « 2026-2027 »
  groupe text not null,                  -- sigle du groupe (SOC, LFI-NFP, DR…), comme deputies.party
  -- [{ ordre, ref, titre, objet, auteur, auteur_groupe, statut, statut_libelle, vote_ref,
  --    pour, contre, abstention, dossier_id, url }]
  --  statut : a_venir | adoptee | rejetee | non_achevee | non_examinee | en_attente
  textes jsonb not null default '[]'::jsonb,
  empreinte text,                        -- change quand un statut change : l'analyse est refaite
  maj_le timestamptz not null default now()
);

alter table public.niches_parlementaires enable row level security;
drop policy if exists "lecture publique" on public.niches_parlementaires;
create policy "lecture publique" on public.niches_parlementaires for select using (true);

create table if not exists public.niches_analyses (
  jour date primary key references public.niches_parlementaires(jour) on delete cascade,
  -- { en_bref, strategie, deroulement, textes:[{ titre, ce_que_ca_change, pour_qui,
  --   arguments_pour:[…], arguments_contre:[…], vote, et_ensuite }], a_retenir:[…] }
  analyse jsonb not null,
  sources jsonb not null default '[]'::jsonb,   -- [{ titre, url }]
  empreinte text,                               -- celle de la niche au moment de l'écriture
  verifie boolean not null default false,       -- relue par le vérificateur (redaction-ia.ts)
  model text,
  cout_usd numeric,
  generated_at timestamptz not null default now()
);

alter table public.niches_analyses enable row level security;

-- Réservé aux abonnés, dans la base et pas seulement à l'affichage.
drop policy if exists "lecture abonnes" on public.niches_analyses;
create policy "lecture abonnes" on public.niches_analyses
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_premium = true or coalesce(p.subscription_tier, 'free') in ('elite', 'pro'))
    )
  );

-- Ce qu'un non-abonné a le droit de savoir : QU'une analyse existe et son ampleur,
-- pour lui montrer ce qu'il manque — jamais son contenu.
create or replace function public.public_niche_apercu(p_jour date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'textes', coalesce(jsonb_array_length(a.analyse->'textes'), 0),
    'arguments', coalesce((
      select sum(coalesce(jsonb_array_length(t->'arguments_pour'), 0) + coalesce(jsonb_array_length(t->'arguments_contre'), 0))
      from jsonb_array_elements(a.analyse->'textes') t
    ), 0),
    -- Par texte, dans l'ordre : combien d'arguments de chaque camp (les compteurs, pas le contenu).
    'par_texte', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pour', coalesce(jsonb_array_length(t->'arguments_pour'), 0),
        'contre', coalesce(jsonb_array_length(t->'arguments_contre'), 0)) order by k)
      from jsonb_array_elements(a.analyse->'textes') with ordinality as x(t, k)
    ), '[]'::jsonb),
    'verifie', a.verifie,
    'mots', coalesce(array_length(regexp_split_to_array(a.analyse::text, '\s+'), 1), 0),
    'generated_at', a.generated_at
  )
  from public.niches_analyses a
  where a.jour = p_jour;
$$;

grant execute on function public.public_niche_apercu(date) to anon, authenticated;
