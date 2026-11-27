-- Instagram à l'heure (27/11/2026). Les crons GitHub partent avec des heures de retard, voire jamais :
-- le 27/11, la préparation de 8 h 10 n'est pas partie et la publication « toutes les 15 min » n'a tourné
-- qu'une fois, à 2 h du matin. pg_cron, lui, est à l'heure : il déclenche instagram-production.yml par
-- l'API GitHub (workflow_dispatch, lancé en quelques secondes).
--
-- Jeton : jeton GitHub « à grain fin », dépôt lapolitique-backend SEUL, permission Actions en écriture,
-- rangé dans le coffre sous le nom « github_actions_token » (créé à part, jamais dans le dépôt) :
--   select vault.create_secret('<jeton>', 'github_actions_token');
-- Les crons GitHub du workflow restent en secours (« Déjà préparé » empêche les doublons).

create or replace function public.ig_declencher(mode text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://api.github.com/repos/lapolitiquecsip/lapolitique-backend/actions/workflows/instagram-production.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_actions_token'),
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'lpcs-pg-cron',
      'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('mode', mode))
  );
end $$;
-- Lit un secret du coffre : jamais appelable depuis le site.
revoke all on function public.ig_declencher(text) from public, anon, authenticated;

-- 8 h 10 heure de Paris l'hiver (9 h 10 l'été) : Noémie prépare les posts du jour.
select cron.schedule('ig-preparer', '10 7 * * *', $$ select public.ig_declencher('preparer') $$);

-- Toutes les 5 min, 7 h-21 h 59 (Paris, hiver) : on ne lance GitHub QUE s'il y a quelque chose à faire,
-- un post validé dont l'heure est venue, ou un post à refaire après « ✏️ ».
select cron.schedule('ig-publier', '*/5 6-20 * * *', $$
  select public.ig_declencher('publier')
  where exists (
    select 1 from public.qg_demandes
    where action = 'publier_instagram'
      and ((statut = 'validee' and (apercu->>'heure')::timestamptz <= now())
        or (statut = 'a_modifier' and coalesce(commentaire, '') <> ''))
  )
$$);
