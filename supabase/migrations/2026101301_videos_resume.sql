-- Fils vidéo de l'Assemblée et du Sénat : le site demande la colonne `resume_ia` (résumé de la
-- vidéo, comme pour les vidéos des candidats), qui n'avait été créée que sur candidate_videos
-- et candidate_debates. La demande échouait (colonne inconnue) et les deux fils s'affichaient
-- vides pour tous les visiteurs.
alter table public.an_videos add column if not exists resume_ia text;
alter table public.an_videos add column if not exists resume_le timestamptz;
alter table public.senat_videos add column if not exists resume_ia text;
alter table public.senat_videos add column if not exists resume_le timestamptz;
