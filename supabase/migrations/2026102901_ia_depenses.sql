-- Journal des dépenses de l'API Claude (29/10/2026) : plafond de 20 $ par mois, tous usages
-- confondus, réparti par poste (src/lib/budget-claude.ts). Lu et écrit par les scripts
-- (clé de service) uniquement : aucune politique RLS, donc aucun accès public.
create table if not exists public.ia_depenses (
  id       bigserial primary key,
  cree_le  timestamptz not null default now(),
  poste    text not null,
  modele   text,
  usd      numeric(10,5) not null,
  detail   text
);
create index if not exists ia_depenses_cree_le on public.ia_depenses (cree_le);
alter table public.ia_depenses enable row level security;

-- Dépenses déjà faites ce mois-ci (annonces de l'Exécutif, e-mails Pro), pour que le plafond
-- d'octobre en tienne compte.
insert into public.ia_depenses (cree_le, poste, modele, usd, detail)
select coalesce(analyse_le, cree_le), 'executif', modele, cout_usd, 'reprise : ' || left(titre, 120)
from public.executif_annonces where cout_usd > 0 and coalesce(analyse_le, cree_le) >= '2026-10-01';
insert into public.ia_depenses (cree_le, poste, modele, usd, detail)
select cree_le, 'digest', modele, cout_usd, 'reprise : ' || left(cle, 120)
from public.digest_enrichissements where cout_usd > 0 and cree_le >= '2026-10-01';
