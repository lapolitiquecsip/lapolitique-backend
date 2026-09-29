-- Intitulé FRANÇAIS d'un vote du Parlement européen.
--
-- L'intitulé officiel est en anglais (« Objection pursuant to Rule 115(2) and (3):
-- Genetically modified maize MON 87460 ») : une alerte de vote ne pouvait donc pas
-- nommer le texte voté avant d'en donner le résumé. Rempli par
-- src/scripts/data/sync-vote-explanations.ts (et son rattrapage --titres-fr).
alter table public.vote_explanations add column if not exists title_fr text;
