-- Résumé « en clair » d'un scrutin (de quoi parle le texte voté), généré par IA à partir
-- du titre officiel. Sert à faire comprendre à l'utilisateur pourquoi son élu a voté ainsi.
ALTER TABLE public.legislative_scrutins
  ADD COLUMN IF NOT EXISTS explanation text;
