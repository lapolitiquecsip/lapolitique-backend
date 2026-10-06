-- Parrainage : versement AUTOMATIQUE des commissions par Stripe Connect.
-- Chaque parrain relie un compte Stripe (Express : identité + IBAN saisis chez Stripe,
-- jamais chez nous). Une fois par jour, les commissions disponibles (délai de validation
-- passé) d'un parrain qui atteint le seuil lui sont transférées ; Stripe les vire ensuite
-- sur son compte bancaire. Un remboursement après transfert reprend la commission.

alter table public.parrains add column if not exists stripe_compte text;
alter table public.parrains add column if not exists versements_actifs boolean not null default false;
alter table public.commissions add column if not exists stripe_transfert text;
alter table public.commissions add column if not exists erreur_versement text;

-- Ce que l'espace « Parrainage » affiche : compte relié ou non, versements actifs.
create or replace function public.mon_compte_versement()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('relie', stripe_compte is not null, 'actif', versements_actifs)
  from parrains where user_id = auth.uid();
$$;
grant execute on function public.mon_compte_versement() to authenticated;

-- Pour la tâche de versement (clé de service) : par parrain prêt, les commissions dues.
create or replace function public.commissions_a_verser()
returns table (parrain_id uuid, stripe_compte text, ids bigint[], factures text[], montants numeric[], total numeric)
language sql stable security definer set search_path = public as $$
  with reg as (select * from parrainage_reglages limit 1)
  select c.parrain_id, p.stripe_compte, array_agg(c.id order by c.id), array_agg(c.stripe_facture order by c.id),
         array_agg(c.commission order by c.id), sum(c.commission)
  from commissions c join parrains p on p.user_id = c.parrain_id, reg
  where c.statut = 'en_attente' and c.stripe_transfert is null
    and c.creee_le <= now() - make_interval(days => reg.delai_validation_jours)
    and p.stripe_compte is not null and p.versements_actifs
  group by c.parrain_id, p.stripe_compte, reg.seuil_versement
  having sum(c.commission) >= reg.seuil_versement;
$$;
revoke all on function public.commissions_a_verser() from public, anon, authenticated;

-- Remboursement d'un paiement déjà reversé : la commission est annulée (le transfert
-- est repris côté Stripe par le webhook). Renvoie le transfert à reprendre, s'il y en a un.
drop function if exists public.annuler_commission(text);
create function public.annuler_commission(p_facture text)
returns text language plpgsql security definer set search_path = public as $$
declare tr text;
begin
  select stripe_transfert into tr from commissions where stripe_facture = p_facture and statut = 'versee';
  update commissions set statut = 'annulee' where stripe_facture = p_facture and statut in ('en_attente', 'versee');
  return tr;
end $$;
revoke execute on function public.annuler_commission(text) from public, anon, authenticated;
