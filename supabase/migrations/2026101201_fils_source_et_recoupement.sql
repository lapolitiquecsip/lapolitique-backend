-- Fils d'actualité nourris par la presse : d'où vient l'information, et qui d'autre la donne.
--
-- Jusqu'ici une information reprise de la presse s'affichait « Source : Google News », et la
-- base ne gardait ni le nom du journal, ni le titre d'origine, ni l'extrait dont le résumé
-- était tiré : personne — lecteur ou agent — ne pouvait remonter à ce qui avait été lu.
--
--   media            le journal qui a publié l'article (« Ouest-France »)
--   titre_origine    le titre tel que le journal l'a écrit, avant réécriture
--   extrait_origine  l'extrait fourni par le flux, seule matière du résumé
--   recoupement      officiel | recoupe | unique — « unique » = aucun autre média trouvé
--   autres_medias    nombre d'autres médias rapportant le même fait
alter table public.entity_feed
  add column if not exists media text,
  add column if not exists titre_origine text,
  add column if not exists extrait_origine text,
  add column if not exists recoupement text,
  add column if not exists autres_medias int,
  add column if not exists recoupe_le timestamptz;
