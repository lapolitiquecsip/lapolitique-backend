-- Conformité : droits RGPD en libre-service, preuve des accords donnés à l'achat,
-- mentions légales des sondages, durées de conservation.

-- 1. Sondages : loi n° 77-808 du 19 juillet 1977, art. 2 — toute publication nomme
--    l'acheteur et renvoie à la notice déposée à la Commission des sondages.
alter table public.sondages add column if not exists notice_url text;
alter table public.sondages add column if not exists commanditaire text;

-- 2. Preuve des accords (CGV, exécution immédiate avant la fin du délai de
--    rétractation : C. conso. L221-25 ; opinions politiques : RGPD art. 9 et 7.1).
create table if not exists public.preuves_consentement (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  objet text not null check (objet in ('achat', 'suivis_politiques')),
  version text not null,
  details jsonb not null default '{}'::jsonb,
  cree_le timestamptz not null default now()
);
create index if not exists preuves_consentement_user on public.preuves_consentement(user_id, objet, cree_le desc);
alter table public.preuves_consentement enable row level security;
drop policy if exists "preuves : lecture des siennes" on public.preuves_consentement;
create policy "preuves : lecture des siennes" on public.preuves_consentement for select using (auth.uid() = user_id);
drop policy if exists "preuves : ajout des siennes" on public.preuves_consentement;
create policy "preuves : ajout des siennes" on public.preuves_consentement for insert with check (auth.uid() = user_id);

-- 3. Droit d'accès et à la portabilité (RGPD art. 15 et 20) : tout ce qui est rattaché
--    au compte, en un fichier.
create or replace function public.exporter_mes_donnees()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'non_connecte'; end if;
  return jsonb_build_object(
    'genere_le', now(),
    'compte', (select jsonb_build_object('email', email, 'cree_le', created_at, 'derniere_connexion', last_sign_in_at) from auth.users where id = uid),
    'profil', (select to_jsonb(p) from profiles p where p.id = uid),
    'abonnement', (select coalesce(jsonb_agg(to_jsonb(s) - 'stripe_customer_id' - 'stripe_subscription_id'), '[]') from subscribers s where s.user_id = uid),
    'preferences', (select to_jsonb(p) - 'jeton_desabo' from user_preferences p where p.user_id = uid),
    'elus_suivis', (select coalesce(jsonb_agg(to_jsonb(f)), '[]') from user_follows f where f.user_id = uid),
    'suivis', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from user_suivis s where s.user_id = uid),
    'votes_citoyens', (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from user_votes v where v.user_id = uid),
    'elements_enregistres', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from user_saved_items i where i.user_id = uid),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]') from (select * from user_notifications where user_id = uid order by created_at desc limit 2000) n),
    'recaps_envoyes', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from recaps_envoyes r where r.user_id = uid),
    'parrainage', (select to_jsonb(p) from parrains p where p.user_id = uid),
    'commissions', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from commissions c where c.parrain_id = uid or c.filleul_id = uid),
    'accords', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from preuves_consentement c where c.user_id = uid)
  );
end $$;
revoke all on function public.exporter_mes_donnees() from public, anon;
grant execute on function public.exporter_mes_donnees() to authenticated;

-- 4. Droit à l'effacement (RGPD art. 17). Un abonnement payant en cours doit d'abord
--    être résilié (sinon Stripe continuerait de prélever un compte disparu).
create or replace function public.supprimer_mon_compte()
returns text language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'non_connecte'; end if;
  if exists (select 1 from subscribers where user_id = uid and status in ('active', 'trialing', 'past_due')
             and stripe_subscription_id is not null) then
    return 'abonnement_actif';
  end if;
  -- Tables sans clé étrangère vers auth.users : effacées à la main.
  delete from user_follows where user_id = uid;
  delete from user_votes where user_id = uid;
  update profiles set parrain_id = null where parrain_id = uid;
  delete from auth.users where id = uid;   -- le reste suit (on delete cascade)
  return 'supprime';
end $$;
revoke all on function public.supprimer_mon_compte() from public, anon;
grant execute on function public.supprimer_mon_compte() to authenticated;

-- 5. Durées de conservation (RGPD art. 5.1.e) : notifications 12 mois, récaps 12 mois.
--    La mesure d'audience se purge déjà seule (13 mois).
create or replace function public.purge_conservation()
returns jsonb language plpgsql security definer set search_path = public as $$
declare n1 int; n2 int;
begin
  delete from user_notifications where created_at < now() - interval '12 months';
  get diagnostics n1 = row_count;
  delete from recaps_envoyes where envoye_le < now() - interval '12 months';
  get diagnostics n2 = row_count;
  return jsonb_build_object('notifications', n1, 'recaps', n2);
end $$;
revoke all on function public.purge_conservation() from public, anon, authenticated;
