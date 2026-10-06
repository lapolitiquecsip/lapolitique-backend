-- FUITE : la politique « Allow subscribers insertion » est en réalité un SELECT ouvert
-- à tous (qual = true) : n'importe qui, avec la clé publique du site, peut lire les
-- e-mails, codes postaux, tranches d'âge et identifiants Stripe des abonnés (vérifié le
-- 06/10/2026 en rôle anon : 2 lignes lisibles). L'INSERT anonyme (inutilisé : le site
-- n'appelle plus subscribeNewsletter, le backend écrit avec la clé de service) part avec.
drop policy if exists "Allow subscribers insertion" on public.subscribers;
drop policy if exists "Enable read access for all users" on public.subscribers;
drop policy if exists "subscribers : lecture administrateurs" on public.subscribers;
create policy "subscribers : lecture administrateurs" on public.subscribers
  for select using (public.est_administrateur());
-- Reste en place : « Users can manage own subscriber row » (auth.uid() = user_id).
