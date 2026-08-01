-- Permet à l'utilisateur premium d'EFFACER ses notifications déjà lues
-- (« Tout marquer lu » vide le fil des votes anciens qu'il considère comme lus).
-- Chacun ne peut supprimer QUE ses propres notifications.
DROP POLICY IF EXISTS "own notifications delete" ON public.user_notifications;
CREATE POLICY "own notifications delete" ON public.user_notifications
  FOR DELETE USING (auth.uid() = user_id);

GRANT DELETE ON public.user_notifications TO authenticated;
