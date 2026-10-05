-- ─────────────────────────────────────────────────────────────────────────────
-- Administration : donner (ou retirer) un accès Premium / Pro à un membre.
--
-- Un accès donné à la main est marqué « offert » : il se distingue d'un
-- abonnement payé dans la liste des membres et ne compte pas dans le revenu
-- estimé. Un paiement Stripe ultérieur efface la marque (le webhook la remet à
-- false en activant l'abonnement).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists niveau_offert boolean not null default false;

create or replace function public.definir_niveau(p_user uuid, p_niveau text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not est_administrateur() then raise exception 'Réservé aux administrateurs du site'; end if;
  if p_niveau not in ('free', 'elite', 'pro') then return 'niveau_invalide'; end if;
  update profiles
     set subscription_tier = p_niveau,
         is_premium = (p_niveau <> 'free'),
         niveau_offert = (p_niveau <> 'free')
   where id = p_user;
  if not found then return 'membre_introuvable'; end if;
  return 'ok';
end $$;
grant execute on function public.definir_niveau(uuid, text) to authenticated;

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
        'offerts', count(*) filter (where p.niveau_offert and p.subscription_tier in ('elite', 'pro')),
        'nouveaux_7j', count(*) filter (where u.created_at > now() - interval '7 days'),
        'nouveaux_30j', count(*) filter (where u.created_at > now() - interval '30 days'),
        'actifs_7j', count(*) filter (where u.last_sign_in_at > now() - interval '7 days'),
        'parraines', count(*) filter (where p.parrain_id is not null),
        -- Les accès offerts ne rapportent rien : hors du revenu estimé.
        'revenu_mensuel_estime', round(3.99 * count(*) filter (where p.subscription_tier = 'elite' and not p.niveau_offert)
                                       + 24.99 * count(*) filter (where p.subscription_tier = 'pro' and not p.niveau_offert), 2))
      from auth.users u left join profiles p on p.id = u.id),
    'inscriptions_par_jour', (select coalesce(jsonb_agg(x order by x.jour), '[]'::jsonb) from (
        select (u.created_at at time zone 'Europe/Paris')::date as jour, count(*) as n
        from auth.users u where u.created_at > now() - interval '60 days' group by 1) x),
    'membres', (select coalesce(jsonb_agg(x order by x.cree_le desc), '[]'::jsonb) from (
        select u.id, u.email, u.created_at as cree_le, u.last_sign_in_at as derniere_connexion,
               u.email_confirmed_at is not null as confirme,
               coalesce(p.subscription_tier, 'free') as niveau,
               coalesce(p.niveau_offert, false) as offert,
               p.stripe_customer_id,
               (select email from auth.users pu where pu.id = p.parrain_id) as parrain,
               (select count(*) from profiles f where f.parrain_id = u.id) as filleuls,
               exists (select 1 from administrateurs a where a.user_id = u.id) as administrateur
        from auth.users u left join profiles p on p.id = u.id
        order by u.created_at desc limit 5000) x)
  );
end $$;
grant execute on function public.membres_admin() to authenticated;
