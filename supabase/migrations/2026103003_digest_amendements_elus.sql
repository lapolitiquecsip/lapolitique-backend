-- Rubrique Pro « Votes de vos élus sur les amendements » (30/10/2026) : le lien « Ne plus
-- recevoir cette rubrique » de l'e-mail doit la connaître.
create or replace function public.desabonner_digest(p_jeton uuid, p_categorie text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if p_categorie = 'tout' then
    update user_preferences set abonnements_pro = '{}'::jsonb, updated_at = now() where jeton_desabo = p_jeton;
  elsif p_categorie in ('commissions', 'textes', 'jo', 'elus', 'amendements_elus', 'europe', 'territoire') then
    update user_preferences set abonnements_pro = abonnements_pro || jsonb_build_object(p_categorie, 'aucun'), updated_at = now()
     where jeton_desabo = p_jeton;
  else
    return 'inconnu';
  end if;
  if not found then return 'inconnu'; end if;
  return 'ok';
end $$;
grant execute on function public.desabonner_digest(uuid, text) to anon, authenticated;
