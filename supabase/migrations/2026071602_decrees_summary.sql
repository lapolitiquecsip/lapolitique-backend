-- Résumé "ce que ça implique" par décret (règles gratuites + IA off-peak pour les réglementaires).
ALTER TABLE public.decrees ADD COLUMN IF NOT EXISTS summary TEXT;
