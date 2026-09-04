-- Fiches parti enrichies : idéologie (liste de courants/valeurs) + réseaux sociaux officiels
-- (pour que l'utilisateur suive le parti directement). Remplis par enrich-parties
-- (idéologie = IA depuis Wikipédia ; réseaux = Wikidata, fiable). `website` existe déjà.
alter table public.political_parties
  add column if not exists ideology text[],
  add column if not exists twitter text,
  add column if not exists facebook text,
  add column if not exists instagram text,
  add column if not exists youtube text,
  add column if not exists tiktok text;
