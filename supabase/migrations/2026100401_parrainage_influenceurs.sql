-- ─────────────────────────────────────────────────────────────────────────────
-- Parrainage : réglages par influenceur.
--
-- Un influenceur veut un lien qui porte son nom (?ref=NOMDELINFLUENCEUR) et
-- négocie souvent un taux à part. Le code et le taux deviennent donc réglables
-- par parrain depuis l'administration ; le taux général reste celui de
-- `parrainage_reglages` pour tous les autres.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.parrains
  add column if not exists taux numeric check (taux is null or (taux >= 0 and taux <= 0.8)),
  add column if not exists nom text;

/* Le taux applicable à un parrain : le sien s'il en a un, sinon le taux général. */
create or replace function public.taux_du_parrain(p_parrain uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select taux from parrains where user_id = p_parrain),
                  (select taux from parrainage_reglages where id = 1));
$$;
revoke execute on function public.taux_du_parrain(uuid) from public, anon, authenticated;

create or replace function public.enregistrer_commission(p_filleul uuid, p_facture text, p_montant numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_parrain uuid; reg parrainage_reglages; v_premier timestamptz; v_taux numeric;
begin
  select parrain_id into v_parrain from profiles where id = p_filleul;
  if v_parrain is null or v_parrain = p_filleul or coalesce(p_montant, 0) <= 0 or coalesce(p_facture, '') = '' then
    return jsonb_build_object('commission', false);
  end if;
  select * into reg from parrainage_reglages where id = 1;
  select min(creee_le) into v_premier from commissions where filleul_id = p_filleul;
  if v_premier is not null and now() > v_premier + make_interval(months => reg.duree_mois) then
    return jsonb_build_object('commission', false, 'raison', 'au-delà de la durée de parrainage');
  end if;
  v_taux := taux_du_parrain(v_parrain);
  insert into commissions (parrain_id, filleul_id, stripe_facture, montant_paye, taux, commission)
  values (v_parrain, p_filleul, p_facture, round(p_montant, 2), v_taux, round(p_montant * v_taux, 2))
  on conflict (stripe_facture) do nothing;
  return jsonb_build_object('commission', true);
end $$;
revoke execute on function public.enregistrer_commission(uuid, text, numeric) from public, anon, authenticated;

/* Le tableau du parrain affiche SON taux. */
create or replace function public.mon_parrainage()
returns jsonb language plpgsql security definer set search_path = public as $$
declare moi uuid := auth.uid(); v_code text; reg parrainage_reglages;
begin
  if moi is null then raise exception 'Connexion requise'; end if;
  select code into v_code from parrains where user_id = moi;
  while v_code is null loop
    v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
               from generate_series(1, 7));
    begin
      insert into parrains (user_id, code) values (moi, v_code);
    exception when unique_violation then v_code := null;
    end;
  end loop;
  select * into reg from parrainage_reglages where id = 1;
  return jsonb_build_object(
    'code', v_code,
    'taux', taux_du_parrain(moi), 'duree_mois', reg.duree_mois,
    'delai_validation_jours', reg.delai_validation_jours, 'seuil_versement', reg.seuil_versement,
    'clics', (select count(distinct visiteur) from site_events where ref_code = v_code and name = 'arrivee_parrainage'),
    'inscrits', (select count(*) from profiles where parrain_id = moi),
    'abonnes', (select count(*) from profiles where parrain_id = moi and subscription_tier in ('elite', 'pro')),
    'en_validation', (select coalesce(sum(commission), 0) from commissions where parrain_id = moi and statut = 'en_attente'
                      and creee_le > now() - make_interval(days => reg.delai_validation_jours)),
    'disponible', (select coalesce(sum(commission), 0) from commissions where parrain_id = moi and statut = 'en_attente'
                   and creee_le <= now() - make_interval(days => reg.delai_validation_jours)),
    'verse', (select coalesce(sum(commission), 0) from commissions where parrain_id = moi and statut = 'versee'),
    'historique', (select coalesce(jsonb_agg(x order by x.creee_le desc), '[]'::jsonb) from (
        select creee_le, montant_paye, commission, statut from commissions
        where parrain_id = moi order by creee_le desc limit 50) x)
  );
end $$;
grant execute on function public.mon_parrainage() to authenticated;

/* Administration : créer ou régler le lien d'un influenceur (il doit avoir un compte). */
create or replace function public.configurer_parrain(p_email text, p_code text, p_taux numeric, p_nom text)
returns text language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_code text := upper(trim(coalesce(p_code, '')));
begin
  if not est_administrateur() then raise exception 'Réservé aux administrateurs du site'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then return 'compte_introuvable'; end if;
  if v_code !~ '^[A-Z0-9-]{3,30}$' then return 'code_invalide'; end if;
  if exists (select 1 from parrains where code = v_code and user_id <> v_user) then return 'code_pris'; end if;
  if p_taux is not null and (p_taux < 0 or p_taux > 0.8) then return 'taux_invalide'; end if;
  insert into parrains (user_id, code, taux, nom) values (v_user, v_code, p_taux, nullif(trim(p_nom), ''))
  on conflict (user_id) do update set code = excluded.code, taux = excluded.taux, nom = excluded.nom;
  return 'ok';
end $$;
grant execute on function public.configurer_parrain(text, text, numeric, text) to authenticated;

/* Vue d'administration, avec taux et nom de chaque parrain. */
create or replace function public.parrainage_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare reg parrainage_reglages;
begin
  if not est_administrateur() then raise exception 'Réservé aux administrateurs du site'; end if;
  select * into reg from parrainage_reglages where id = 1;
  return jsonb_build_object(
    'reglages', to_jsonb(reg),
    'parrains', (select coalesce(jsonb_agg(x order by x.disponible desc, x.inscrits desc), '[]'::jsonb) from (
      select p.user_id, p.code, p.nom, p.taux as taux_propre, coalesce(p.taux, reg.taux) as taux, u.email,
        (select count(distinct visiteur) from site_events e where e.ref_code = p.code and e.name = 'arrivee_parrainage') as clics,
        (select count(*) from profiles f where f.parrain_id = p.user_id) as inscrits,
        (select count(*) from profiles f where f.parrain_id = p.user_id and f.subscription_tier in ('elite', 'pro')) as abonnes,
        (select coalesce(sum(c.commission), 0) from commissions c where c.parrain_id = p.user_id and c.statut = 'en_attente'
           and c.creee_le > now() - make_interval(days => reg.delai_validation_jours)) as en_validation,
        (select coalesce(sum(c.commission), 0) from commissions c where c.parrain_id = p.user_id and c.statut = 'en_attente'
           and c.creee_le <= now() - make_interval(days => reg.delai_validation_jours)) as disponible,
        (select coalesce(sum(c.commission), 0) from commissions c where c.parrain_id = p.user_id and c.statut = 'versee') as verse
      from parrains p join auth.users u on u.id = p.user_id) x)
  );
end $$;
grant execute on function public.parrainage_admin() to authenticated;
