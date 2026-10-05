-- ─────────────────────────────────────────────────────────────────────────────
-- Statistiques du site (temps réel) et programme de parrainage.
--
-- 1. MESURE D'AUDIENCE maison, sans cookie : un identifiant aléatoire par
--    navigateur (visiteur) et par onglet (session), rien qui identifie une
--    personne. Exemptée de consentement par la CNIL tant qu'elle reste anonyme,
--    limitée à la mesure d'audience et conservée 13 mois au plus.
-- 2. PARRAINAGE : chaque membre a un lien ; un nouveau membre arrivé par ce lien
--    est rattaché à son parrain ; chaque paiement Stripe du filleul (premier
--    paiement et renouvellements, pendant `duree_mois`) ouvre une commission de
--    `taux`, validée après `delai_validation_jours` (rétractation, rembourse-
--    ments), puis versée à la main par virement.
-- ─────────────────────────────────────────────────────────────────────────────

/* ═══════════════════════════ Administrateurs ═══════════════════════════════
 * Table à part : le rôle « admin » de `profiles` ouvre aussi les accès premium
 * (has_premium_access), ce qui fausserait les essais d'un compte « classique ». */
create table if not exists public.administrateurs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ajoute_le timestamptz not null default now()
);
alter table public.administrateurs enable row level security;

create or replace function public.est_administrateur()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from administrateurs where user_id = auth.uid());
$$;
grant execute on function public.est_administrateur() to authenticated;

insert into public.administrateurs (user_id)
select id from auth.users where lower(email) = 'lapolitiquecsimple@gmail.com'   -- seul administrateur du site
on conflict do nothing;

/* ═══════════════════════════ Mesure d'audience ═════════════════════════════ */
create table if not exists public.site_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('vue', 'action')),
  name text,                 -- nom de l'action (inscription, clic_paiement, partage…)
  path text not null,
  referrer text,             -- domaine d'où vient la visite
  visiteur text not null,    -- aléatoire, propre au navigateur
  session text not null,     -- aléatoire, propre à l'onglet
  device text,               -- mobile / tablette / ordinateur
  ref_code text,             -- code de parrainage actif sur cette visite
  niveau text                -- anonyme / free / elite / pro
);
create index if not exists site_events_at on public.site_events (at desc);
create index if not exists site_events_session on public.site_events (session, at desc);
create index if not exists site_events_ref on public.site_events (ref_code, at desc) where ref_code is not null;
alter table public.site_events enable row level security;   -- aucune lecture directe

create or replace function public.enregistrer_evenement(
  p_kind text, p_name text, p_path text, p_referrer text, p_visiteur text,
  p_session text, p_device text, p_ref text, p_niveau text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('vue', 'action') or coalesce(p_path, '') = ''
     or coalesce(p_session, '') = '' or coalesce(p_visiteur, '') = '' then
    return;
  end if;
  -- Une session qui envoie plus de 300 événements en une heure est un robot ou
  -- une boucle : on cesse d'enregistrer, sans erreur.
  if (select count(*) from site_events
      where session = left(p_session, 64) and at > now() - interval '1 hour') >= 300 then
    return;
  end if;
  insert into site_events (kind, name, path, referrer, visiteur, session, device, ref_code, niveau)
  values (p_kind, left(p_name, 60), left(p_path, 300), left(p_referrer, 120), left(p_visiteur, 64),
          left(p_session, 64), left(p_device, 20), nullif(left(upper(trim(p_ref)), 40), ''), left(p_niveau, 10));
  -- Ménage occasionnel : 13 mois au plus (recommandation CNIL).
  if random() < 0.002 then
    delete from site_events where at < now() - interval '13 months';
  end if;
end $$;
grant execute on function public.enregistrer_evenement(text, text, text, text, text, text, text, text, text)
  to anon, authenticated;

create or replace function public.statistiques_site(p_jours int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  debut timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_jours, 30), 400)));
  minuit timestamptz := (date_trunc('day', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';
begin
  if not est_administrateur() then raise exception 'Réservé aux administrateurs du site'; end if;
  return jsonb_build_object(
    -- Début de l'historique : une période plus longue que lui affiche les mêmes chiffres.
    'debut_mesure', (select min(at) from site_events),
    -- Ce qui intéresse : vues, visiteurs et temps passé par rubrique. Le temps d'une
    -- page est l'écart jusqu'à la page suivante de la même visite (plafonné à 30 min) ;
    -- la dernière page d'une visite n'a pas de durée connue et n'entre pas dans la moyenne.
    'rubriques', (select coalesce(jsonb_agg(x order by x.vues desc), '[]'::jsonb) from (
        select rubrique, count(*) as vues, count(distinct visiteur) as visiteurs, round(avg(duree))::int as temps_moyen
        from (
          select visiteur,
            least(extract(epoch from (lead(at) over (partition by session order by at) - at)), 1800) as duree,
            case
              when path = '/' then 'Accueil'
              when path like '/lois%' then 'Lois'
              when path like '/deputes%' then 'Députés'
              when path like '/senateurs%' then 'Sénateurs'
              when path like '/eurodeputes%' or path like '/europe%' or path like '/groupes-europeens%' then 'Europe'
              when path like '/presidentielles-2027%' then 'Présidentielles 2027'
              when path like '/local%' or path like '/departements%' or path like '/maires%' then 'Local'
              when path like '/executif%' or path like '/presidents%' then 'Exécutif'
              when path like '/partis%' then 'Partis'
              when path like '/institutions%' or path like '/vocabulaire%' or path like '/faq%' then 'Comprendre'
              when path like '/comparateur%' then 'Comparateur'
              when path like '/promesses%' then 'Promesses'
              when path like '/calendrier%' then 'Agenda'
              when path like '/premium%' or path like '/success%' then 'Offres'
              when path like '/dashboard%' or path like '/parrainage%' then 'Espace personnel'
              when path like '/login%' or path like '/auth%' then 'Connexion'
              else 'Autres pages'
            end as rubrique
          from site_events where at >= debut and kind = 'vue' and path not like '/admin%'
        ) v group by rubrique) x),
    'entrees', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select path, count(*) as n from (
          select distinct on (session) session, path from site_events
          where at >= debut and kind = 'vue' and path not like '/admin%' order by session, at) s
        group by path order by n desc limit 10) x),
    'duree_moyenne_visite', (select round(avg(d))::int from (
        select extract(epoch from (max(at) - min(at))) as d from site_events
        where at >= debut and path not like '/admin%' group by session having count(*) > 1) s),
    'en_ligne', (select count(distinct visiteur) from site_events where at > now() - interval '5 minutes'),
    'en_ligne_pages', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select path, count(distinct visiteur) as n from site_events
        where at > now() - interval '5 minutes' and kind = 'vue' group by path order by n desc limit 8) x),
    'aujourdhui', (select jsonb_build_object('vues', count(*) filter (where kind = 'vue'), 'visiteurs', count(distinct visiteur))
        from site_events where at >= minuit),
    'periode', (select jsonb_build_object('vues', count(*) filter (where kind = 'vue'), 'visiteurs', count(distinct visiteur),
        'sessions', count(distinct session)) from site_events where at >= debut),
    'par_jour', (select coalesce(jsonb_agg(x order by x.jour), '[]'::jsonb) from (
        select (at at time zone 'Europe/Paris')::date as jour, count(*) filter (where kind = 'vue') as vues,
               count(distinct visiteur) as visiteurs
        from site_events where at >= debut group by 1) x),
    'par_heure', (select coalesce(jsonb_agg(x order by x.heure), '[]'::jsonb) from (
        select extract(hour from at at time zone 'Europe/Paris')::int as heure, count(*) filter (where kind = 'vue') as vues
        from site_events where at >= minuit group by 1) x),
    'pages', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select path, count(*) as vues, count(distinct visiteur) as visiteurs from site_events
        where at >= debut and kind = 'vue' and path not like '/admin%' group by path order by vues desc limit 20) x),
    'sources', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(nullif(referrer, ''), '(accès direct)') as source, count(distinct session) as sessions
        from site_events where at >= debut and kind = 'vue' group by 1 order by 2 desc limit 15) x),
    'appareils', (select coalesce(jsonb_object_agg(coalesce(device, 'inconnu'), n), '{}'::jsonb) from (
        select device, count(distinct visiteur) as n from site_events where at >= debut group by device) x),
    'actions', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select name, count(*) as n, count(distinct visiteur) as visiteurs from site_events
        where at >= debut and kind = 'action' group by name order by n desc) x),
    'flux', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select at, kind, name, path, device, niveau from site_events order by at desc limit 40) x),
    'comptes', (select jsonb_build_object(
        'total', count(*),
        'premium', count(*) filter (where subscription_tier = 'elite'),
        'pro', count(*) filter (where subscription_tier = 'pro'),
        'nouveaux', (select count(*) from auth.users where created_at >= debut)) from profiles)
  );
end $$;
grant execute on function public.statistiques_site(int) to authenticated;

/* ═══════════════════════════ Parrainage ════════════════════════════════════ */
create table if not exists public.parrainage_reglages (
  id int primary key default 1 check (id = 1),
  taux numeric not null default 0.20 check (taux >= 0 and taux <= 0.8),
  duree_mois int not null default 12 check (duree_mois between 1 and 120),
  delai_validation_jours int not null default 30,
  seuil_versement numeric not null default 20
);
insert into public.parrainage_reglages (id) values (1) on conflict do nothing;
alter table public.parrainage_reglages enable row level security;
drop policy if exists "lecture publique" on public.parrainage_reglages;
create policy "lecture publique" on public.parrainage_reglages for select using (true);

create table if not exists public.parrains (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  cree_le timestamptz not null default now()
);
alter table public.parrains enable row level security;

alter table public.profiles
  add column if not exists parrain_id uuid references auth.users(id) on delete set null,
  add column if not exists parraine_le timestamptz,
  add column if not exists stripe_customer_id text;
create index if not exists profiles_parrain on public.profiles (parrain_id) where parrain_id is not null;
create index if not exists profiles_stripe_customer on public.profiles (stripe_customer_id) where stripe_customer_id is not null;

create table if not exists public.commissions (
  id bigserial primary key,
  parrain_id uuid not null references auth.users(id) on delete cascade,
  filleul_id uuid not null references auth.users(id) on delete cascade,
  stripe_facture text not null unique,      -- une commission par facture, jamais deux
  montant_paye numeric(10, 2) not null,
  taux numeric not null,
  commission numeric(10, 2) not null,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'versee', 'annulee')),
  creee_le timestamptz not null default now(),
  versee_le timestamptz
);
create index if not exists commissions_parrain on public.commissions (parrain_id, creee_le desc);
alter table public.commissions enable row level security;
drop policy if exists "le parrain voit ses commissions" on public.commissions;
create policy "le parrain voit ses commissions" on public.commissions for select using (parrain_id = auth.uid());

/* Rattachement d'un NOUVEAU membre à son parrain (appelé par le site après
 * l'inscription). Un compte de plus de 30 jours ne peut pas se rattacher : le
 * parrainage récompense l'arrivée d'un membre, pas un rattachement a posteriori. */
create or replace function public.rattacher_parrain(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare v_parrain uuid; v_cree timestamptz;
begin
  if auth.uid() is null then return 'non_connecte'; end if;
  select user_id into v_parrain from parrains where code = upper(trim(p_code));
  if v_parrain is null then return 'code_inconnu'; end if;
  if v_parrain = auth.uid() then return 'soi_meme'; end if;
  select created_at into v_cree from auth.users where id = auth.uid();
  if v_cree < now() - interval '30 days' then return 'compte_ancien'; end if;
  update profiles set parrain_id = v_parrain, parraine_le = now() where id = auth.uid() and parrain_id is null;
  if not found then return 'deja_rattache'; end if;
  return 'ok';
end $$;
grant execute on function public.rattacher_parrain(text) to authenticated;

/* Le tableau de bord du parrain. Crée son code au premier appel. */
create or replace function public.mon_parrainage()
returns jsonb language plpgsql security definer set search_path = public as $$
declare moi uuid := auth.uid(); v_code text; reg parrainage_reglages;
begin
  if moi is null then raise exception 'Connexion requise'; end if;
  select code into v_code from parrains where user_id = moi;
  while v_code is null loop
    -- 7 caractères sans 0/O ni 1/I, faciles à dicter.
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
    'taux', reg.taux, 'duree_mois', reg.duree_mois,
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

/* Appelée par le webhook Stripe (clé de service) à chaque paiement encaissé. */
create or replace function public.enregistrer_commission(p_filleul uuid, p_facture text, p_montant numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_parrain uuid; reg parrainage_reglages; v_premier timestamptz;
begin
  select parrain_id into v_parrain from profiles where id = p_filleul;
  if v_parrain is null or v_parrain = p_filleul or coalesce(p_montant, 0) <= 0 or coalesce(p_facture, '') = '' then
    return jsonb_build_object('commission', false);
  end if;
  select * into reg from parrainage_reglages where id = 1;
  -- Les paiements des `duree_mois` premiers mois du filleul, comptés depuis son premier paiement.
  select min(creee_le) into v_premier from commissions where filleul_id = p_filleul;
  if v_premier is not null and now() > v_premier + make_interval(months => reg.duree_mois) then
    return jsonb_build_object('commission', false, 'raison', 'au-delà de la durée de parrainage');
  end if;
  insert into commissions (parrain_id, filleul_id, stripe_facture, montant_paye, taux, commission)
  values (v_parrain, p_filleul, p_facture, round(p_montant, 2), reg.taux, round(p_montant * reg.taux, 2))
  on conflict (stripe_facture) do nothing;
  return jsonb_build_object('commission', true);
end $$;
revoke execute on function public.enregistrer_commission(uuid, text, numeric) from public, anon, authenticated;

/* Remboursement : la commission de cette facture tombe, si elle n'est pas déjà versée. */
create or replace function public.annuler_commission(p_facture text)
returns void language sql security definer set search_path = public as $$
  update commissions set statut = 'annulee' where stripe_facture = p_facture and statut = 'en_attente';
$$;
revoke execute on function public.annuler_commission(text) from public, anon, authenticated;

/* Vue d'administration : ce que chaque parrain a gagné et ce qui est à verser. */
create or replace function public.parrainage_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare reg parrainage_reglages;
begin
  if not est_administrateur() then raise exception 'Réservé aux administrateurs du site'; end if;
  select * into reg from parrainage_reglages where id = 1;
  return jsonb_build_object(
    'reglages', to_jsonb(reg),
    'parrains', (select coalesce(jsonb_agg(x order by x.disponible desc, x.inscrits desc), '[]'::jsonb) from (
      select p.user_id, p.code, u.email,
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

/* Après un virement : les commissions disponibles de ce parrain passent à « versée ». */
create or replace function public.marquer_commissions_versees(p_parrain uuid)
returns int language plpgsql security definer set search_path = public as $$
declare reg parrainage_reglages; n int;
begin
  if not est_administrateur() then raise exception 'Réservé aux administrateurs du site'; end if;
  select * into reg from parrainage_reglages where id = 1;
  update commissions set statut = 'versee', versee_le = now()
  where parrain_id = p_parrain and statut = 'en_attente'
    and creee_le <= now() - make_interval(days => reg.delai_validation_jours);
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.marquer_commissions_versees(uuid) to authenticated;
