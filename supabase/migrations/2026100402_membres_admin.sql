-- ─────────────────────────────────────────────────────────────────────────────
-- Administration : la liste des membres et des abonnés.
--
-- Tous les comptes (date d'inscription, dernière connexion, adresse confirmée ou
-- non, niveau d'abonnement, parrain, nombre de filleuls), les totaux, les
-- inscriptions jour par jour et un revenu mensuel récurrent ESTIMÉ (Premium
-- 3,99 €, Pro 24,99 € ; un Pro annuel compte pour 239 / 12). Réservé aux
-- administrateurs : la fonction refuse tous les autres.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.membres_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not est_administrateur() then raise exception 'Réservé aux administrateurs du site'; end if;
  return jsonb_build_object(
    'totaux', (select jsonb_build_object(
        'comptes', count(*),
        'confirmes', count(*) filter (where u.email_confirmed_at is not null),
        'premium', count(*) filter (where p.subscription_tier = 'elite'),
        'pro', count(*) filter (where p.subscription_tier = 'pro'),
        'nouveaux_7j', count(*) filter (where u.created_at > now() - interval '7 days'),
        'nouveaux_30j', count(*) filter (where u.created_at > now() - interval '30 days'),
        'actifs_7j', count(*) filter (where u.last_sign_in_at > now() - interval '7 days'),
        'parraines', count(*) filter (where p.parrain_id is not null),
        'revenu_mensuel_estime', round(3.99 * count(*) filter (where p.subscription_tier = 'elite')
                                       + 24.99 * count(*) filter (where p.subscription_tier = 'pro'), 2))
      from auth.users u left join profiles p on p.id = u.id),
    'inscriptions_par_jour', (select coalesce(jsonb_agg(x order by x.jour), '[]'::jsonb) from (
        select (u.created_at at time zone 'Europe/Paris')::date as jour, count(*) as n
        from auth.users u where u.created_at > now() - interval '60 days' group by 1) x),
    'membres', (select coalesce(jsonb_agg(x order by x.cree_le desc), '[]'::jsonb) from (
        select u.id, u.email, u.created_at as cree_le, u.last_sign_in_at as derniere_connexion,
               u.email_confirmed_at is not null as confirme,
               coalesce(p.subscription_tier, 'free') as niveau,
               p.stripe_customer_id,
               (select email from auth.users pu where pu.id = p.parrain_id) as parrain,
               (select count(*) from profiles f where f.parrain_id = u.id) as filleuls,
               exists (select 1 from administrateurs a where a.user_id = u.id) as administrateur
        from auth.users u left join profiles p on p.id = u.id
        order by u.created_at desc limit 5000) x)
  );
end $$;
grant execute on function public.membres_admin() to authenticated;
