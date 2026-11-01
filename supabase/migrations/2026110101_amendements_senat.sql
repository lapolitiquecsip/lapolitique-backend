-- Amendements du Sénat pour l'offre Pro (01/11/2026), le pendant de amendements_an.
-- Source : AMELI (data.senat.fr), relevé quotidien par sync-amendements-senat.ts.

create table if not exists public.amendements_senat (
  uid              text primary key,        -- SEN + identifiant AMELI
  numero           text not null,           -- « II-675 rect. », « COM-12 »
  texte_uid        text not null,           -- signet du dossier (pjl25-952)
  texte_titre      text,
  texte_numero     text,
  session          text,                    -- « 2026-2027 »
  organe           text,                    -- « Séance publique », « Commission · … »
  division         text,
  ordre            text,
  sort             text,
  sort_le          timestamptz,             -- AMELI ne date pas le sort : jour où on le voit changer
  auteur           text,
  auteur_type      text,
  groupe           text,
  senateur_slug    text,
  cosignataires    text,
  nb_cosignataires integer default 0,
  sous_amendement  boolean default false,
  dispositif       text,
  expose           text,
  url              text,
  ideid            text,                    -- amendements identiques (AMELI)
  scrutin_id       uuid references public.legislative_scrutins(id) on delete set null,
  vote_mode        text,                    -- 'scrutin_public' | 'main_levee' | 'commission'
  depose_le        timestamptz,
  vu_le            timestamptz not null default now(),
  maj_le           timestamptz not null default now()
);
create index if not exists amendements_senat_vu_idx on public.amendements_senat (vu_le desc);
create index if not exists amendements_senat_texte_idx on public.amendements_senat (texte_uid);
create index if not exists amendements_senat_groupe_idx on public.amendements_senat (groupe);
create index if not exists amendements_senat_slug_idx on public.amendements_senat (senateur_slug);
create index if not exists amendements_senat_scrutin_idx on public.amendements_senat (scrutin_id);
create index if not exists amendements_senat_mode_idx on public.amendements_senat (vote_mode);

alter table public.amendements_senat enable row level security;
drop policy if exists "amendements_senat lecture pro" on public.amendements_senat;
create policy "amendements_senat lecture pro" on public.amendements_senat for select using ((select public.est_pro()));

-- Listes des filtres : comme amendements_an_textes, sans contenu.
create or replace view public.amendements_senat_textes as
  select texte_uid, max(texte_titre) as texte_titre, max(texte_numero) as texte_numero, count(*)::integer as nb, max(vu_le) as dernier
  from public.amendements_senat group by texte_uid;
create or replace view public.amendements_senat_groupes as
  select groupe, count(*)::integer as nb from public.amendements_senat where groupe is not null group by groupe;
grant select on public.amendements_senat_textes, public.amendements_senat_groupes to anon, authenticated;

-- Nombre public sur la fiche d'un sénateur ; le contenu reste réservé au Pro.
create or replace function public.nb_amendements_senateur(p_slug text)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from amendements_senat where senateur_slug = p_slug;
$$;
revoke all on function public.nb_amendements_senateur(text) from public;
grant execute on function public.nb_amendements_senateur(text) to anon, authenticated;

-- Vote de chaque groupe, lu sur la page officielle du scrutin (mêmes champs qu'à l'Assemblée).
alter table public.legislative_scrutins add column if not exists group_results jsonb;
