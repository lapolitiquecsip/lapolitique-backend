-- Alertes d'amendements pour les membres Pro (30/10/2026) : suivre un texte (amdt_texte, ref =
-- texte_uid de l'AN) ou un groupe politique (amdt_groupe, ref = groupe tel qu'écrit dans
-- amendements_an.groupe, ex. « LFI-NFP »). Alertes envoyées après chaque relevé horaire
-- (backend alertes-amendements.ts).
alter table public.user_suivis drop constraint if exists user_suivis_kind_check;
alter table public.user_suivis add constraint user_suivis_kind_check
  check (kind in ('parti', 'ministere', 'candidat', 'commission', 'amdt_texte', 'amdt_groupe'));

-- Fiche député : le NOMBRE d'amendements déposés est public (le contenu reste réservé au Pro,
-- par la RLS de amendements_an). Sert d'aperçu aux visiteurs non Pro.
create or replace function public.nb_amendements_depute(p_slug text)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from amendements_an where depute_slug = p_slug;
$$;
revoke all on function public.nb_amendements_depute(text) from public;
grant execute on function public.nb_amendements_depute(text) to anon, authenticated;
