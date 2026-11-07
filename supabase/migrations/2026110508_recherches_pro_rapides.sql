-- Recherches Pro : sous les règles d'accès (RLS), PostgreSQL n'utilise pas l'index plein texte
-- (l'opérateur @@ n'est pas « leakproof ») et relit toutes les lignes : 8 s et plus pour un membre,
-- contre moins d'une seconde côté serveur. Chaque fonction de recherche devient une enveloppe
-- SECURITY DEFINER qui vérifie elle-même le droit d'accès (membre Pro, ou service du site), puis
-- appelle la recherche d'origine, qui lit alors les tables avec leurs index.

-- Débats
alter function public.chercher_debats(text, date, text, integer, integer) rename to chercher_debats_brut;
revoke execute on function public.chercher_debats_brut(text, date, text, integer, integer) from public, anon, authenticated;
create function public.chercher_debats(p_q text, p_depuis date default null, p_acteur text default null, p_limite integer default 30, p_decalage integer default 0)
returns table (id text, seance_uid text, date_seance timestamptz, point text, acteur_ref text, orateur text, qualite text, extrait text, rang real, url text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.est_pro() or auth.role() = 'service_role') then raise exception 'Réservé aux abonnés Pro'; end if;
  return query select * from public.chercher_debats_brut(p_q, p_depuis, p_acteur, p_limite, p_decalage);
end $$;

alter function public.qui_parle_de(text, date, integer) rename to qui_parle_de_brut;
revoke execute on function public.qui_parle_de_brut(text, date, integer) from public, anon, authenticated;
create function public.qui_parle_de(p_q text, p_depuis date default null, p_limite integer default 20)
returns table (acteur_ref text, orateur text, qualite text, interventions bigint, derniere timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.est_pro() or auth.role() = 'service_role') then raise exception 'Réservé aux abonnés Pro'; end if;
  return query select * from public.qui_parle_de_brut(p_q, p_depuis, p_limite);
end $$;

-- Questions
alter function public.chercher_questions(text, date, text, integer, integer) rename to chercher_questions_brut;
revoke execute on function public.chercher_questions_brut(text, date, text, integer, integer) from public, anon, authenticated;
create function public.chercher_questions(p_q text, p_depuis date default null, p_statut text default null, p_limite integer default 30, p_decalage integer default 0)
returns table (uid text, type text, numero text, objet text, acteur_ref text, groupe text, ministere text, date_question date, date_reponse date, statut text, extrait text, url text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.est_pro() or auth.role() = 'service_role') then raise exception 'Réservé aux abonnés Pro'; end if;
  return query select * from public.chercher_questions_brut(p_q, p_depuis, p_statut, p_limite, p_decalage);
end $$;

-- Cartographie et cosignatures
alter function public.cartographie_sujet(text, date, integer) rename to cartographie_sujet_brut;
revoke execute on function public.cartographie_sujet_brut(text, date, integer) from public, anon, authenticated;
create function public.cartographie_sujet(p_q text, p_depuis date default null, p_limite integer default 60)
returns table (chambre text, slug text, nom text, groupe text, interventions bigint, questions bigint, amendements bigint, adoptes bigint, score bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.est_pro() or auth.role() = 'service_role') then raise exception 'Réservé aux abonnés Pro'; end if;
  return query select * from public.cartographie_sujet_brut(p_q, p_depuis, p_limite);
end $$;

alter function public.cosignatures_sujet(text, date) rename to cosignatures_sujet_brut;
revoke execute on function public.cosignatures_sujet_brut(text, date) from public, anon, authenticated;
create function public.cosignatures_sujet(p_q text, p_depuis date default null)
returns table (chambre text, slug text, groupe text, cosignataires text, sort text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.est_pro() or auth.role() = 'service_role') then raise exception 'Réservé aux abonnés Pro'; end if;
  return query select * from public.cosignatures_sujet_brut(p_q, p_depuis);
end $$;

-- Lobbying
alter function public.lobbying_sujet(text, date, integer) rename to lobbying_sujet_brut;
revoke execute on function public.lobbying_sujet_brut(text, date, integer) from public, anon, authenticated;
create function public.lobbying_sujet(p_q text, p_depuis date default null, p_limite integer default 20)
returns table (organisation text, categorie text, url text, activites bigint, derniere date, objets text[], cibles text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.est_pro() or auth.role() = 'service_role') then raise exception 'Réservé aux abonnés Pro'; end if;
  return query select * from public.lobbying_sujet_brut(p_q, p_depuis, p_limite);
end $$;

revoke execute on function public.chercher_debats(text, date, text, integer, integer) from public, anon;
revoke execute on function public.qui_parle_de(text, date, integer) from public, anon;
revoke execute on function public.chercher_questions(text, date, text, integer, integer) from public, anon;
revoke execute on function public.cartographie_sujet(text, date, integer) from public, anon;
revoke execute on function public.cosignatures_sujet(text, date) from public, anon;
revoke execute on function public.lobbying_sujet(text, date, integer) from public, anon;
grant execute on function public.chercher_debats(text, date, text, integer, integer) to authenticated, service_role;
grant execute on function public.qui_parle_de(text, date, integer) to authenticated, service_role;
grant execute on function public.chercher_questions(text, date, text, integer, integer) to authenticated, service_role;
grant execute on function public.cartographie_sujet(text, date, integer) to authenticated, service_role;
grant execute on function public.cosignatures_sujet(text, date) to authenticated, service_role;
grant execute on function public.lobbying_sujet(text, date, integer) to authenticated, service_role;
