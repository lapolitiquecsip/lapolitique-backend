-- Totaux anonymes des positions citoyennes sur une loi. La table user_votes n'est lisible
-- que par l'auteur de chaque ligne (opinion politique, RGPD art. 9) : le site comptait donc
-- « 1 vote cumulé » — le sien. Cette fonction ne renvoie que des totaux, jamais qui a voté.
create or replace function public.stats_vote_citoyen(p_law_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'POUR', count(*) filter (where vote = 'POUR'),
    'CONTRE', count(*) filter (where vote = 'CONTRE'),
    'ABSTENTION', count(*) filter (where vote = 'ABSTENTION'),
    'total', count(*))
  from user_votes where law_id::text = p_law_id;
$$;
grant execute on function public.stats_vote_citoyen(text) to anon, authenticated;

-- Messages du formulaire de contact : conservés 2 ans (politique de confidentialité).
create or replace function public.purge_conservation()
returns jsonb language plpgsql security definer set search_path = public as $$
declare n1 int; n2 int; n3 int;
begin
  delete from user_notifications where created_at < now() - interval '12 months';
  get diagnostics n1 = row_count;
  delete from recaps_envoyes where envoye_le < now() - interval '12 months';
  get diagnostics n2 = row_count;
  delete from contact_messages where created_at < now() - interval '2 years';
  get diagnostics n3 = row_count;
  return jsonb_build_object('notifications', n1, 'recaps', n2, 'contacts', n3);
end $$;
revoke all on function public.purge_conservation() from public, anon, authenticated;
