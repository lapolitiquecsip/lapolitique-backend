-- Champs officiels des sénateurs — source : ODSEN (open data du Sénat).
-- Données précises et fiables pour LES 348 sénateurs en fonction (correspondance 348/348
-- par nom), y compris ceux sans article Wikipédia.
ALTER TABLE public.senators
  ADD COLUMN IF NOT EXISTS senate_matricule TEXT,      -- identifiant officiel (senmat)
  ADD COLUMN IF NOT EXISTS birth_date       DATE,      -- date de naissance
  ADD COLUMN IF NOT EXISTS profession       TEXT,      -- description de la profession (précise)
  ADD COLUMN IF NOT EXISTS csp              TEXT,      -- catégorie socio-professionnelle
  ADD COLUMN IF NOT EXISTS senate_group     TEXT,      -- groupe politique au Sénat
  ADD COLUMN IF NOT EXISTS committee        TEXT,      -- commission permanente
  ADD COLUMN IF NOT EXISTS email            TEXT;      -- courriel officiel
