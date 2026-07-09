-- Messages du formulaire de contact.
-- Site statique (GitHub Pages) sans backend : le formulaire insère directement
-- via la clé anon. RLS n'autorise QUE l'insertion (aucune lecture publique) ;
-- les messages se consultent avec la clé service_role (dashboard Supabase).

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'other',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

-- N'importe qui peut soumettre un message, mais personne (anon) ne peut les lire.
CREATE POLICY "Anyone can submit a contact message"
  ON public.contact_messages FOR INSERT TO anon, authenticated
  WITH CHECK (true);

GRANT INSERT ON public.contact_messages TO anon, authenticated;
GRANT ALL ON public.contact_messages TO service_role;
