-- Contrôle des fils de presse (31/10/2026), après celui du fil des candidats. Rien n'est supprimé.
-- entity_feed : verifie_le = article réellement lu ; sinon, le site montre le titre du journal, sans résumé.
alter table public.entity_feed
  add column if not exists verifie_le timestamptz,
  add column if not exists citation text;
-- Controverses : relecture dans de vrais articles ; une entrée non confirmée est masquée avec son motif.
alter table public.controverses_veille
  add column if not exists verifie_le timestamptz,
  add column if not exists verif_motif text;
