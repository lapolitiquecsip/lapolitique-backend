-- Fil des candidats : un article n'est affiché qu'une fois contrôlé (30/10/2026). L'article WanSquare de
-- 2016 paraissait daté du 22/10/2026, avec un résumé écrit sans lire l'article. Rien n'est supprimé :
-- les anciennes lignes (verifie_le nul) sont seulement masquées.
alter table public.candidate_news
  add column if not exists verifie_le timestamptz,
  add column if not exists citation text,
  add column if not exists rejet_motif text;
create index if not exists candidate_news_verifie on public.candidate_news (candidate_id, date desc) where verifie_le is not null;
-- Preuve de candidature : phrase, média et date, relevés dans un article lu.
alter table public.presidential_candidates add column if not exists candidature_preuve jsonb;
