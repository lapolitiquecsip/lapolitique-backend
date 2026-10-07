-- Sanctions prononcées par le Conseil constitutionnel (juge électoral) : inéligibilité,
-- annulation d'élection, déchéance, démission d'office, rejet du compte présidentiel.
-- Source : base CONSTIT (DILA, données ouvertes). Rattachement aux élus du site par
-- prénom + nom + département de l'élection (homonymes écartés).
create table if not exists public.sanctions_constit (
  cle text primary key,                 -- numéro de décision + personne
  numero text not null,                 -- « 2015-4926 SEN »
  nature text not null,                 -- AN | SEN | D | I | PDR
  date_dec date not null,
  circonscription text,                 -- titre de la décision (« Calvados », « Paris, 1ère circ. »)
  departement text,                     -- département normalisé, pour le rattachement
  solution text not null,               -- solution officielle
  civilite text, prenom text, nom text,
  sanction text not null,               -- « Inéligibilité pour un an », « Élection annulée »…
  motif text,                           -- « Compte de campagne rejeté », « Absence de compte »…
  url text not null
);
create table if not exists public.sanctions_constit_elus (
  cle text not null references public.sanctions_constit(cle) on delete cascade,
  entity_type text not null,            -- deputy | senator | mayor | department_president | candidate | minister | mep
  entity_slug text not null,
  primary key (cle, entity_type, entity_slug)
);
create index if not exists sanctions_constit_elus_entite on public.sanctions_constit_elus(entity_type, entity_slug);
alter table public.sanctions_constit enable row level security;
alter table public.sanctions_constit_elus enable row level security;
drop policy if exists "sanctions lisibles" on public.sanctions_constit;
create policy "sanctions lisibles" on public.sanctions_constit for select using (true);
drop policy if exists "rattachements lisibles" on public.sanctions_constit_elus;
create policy "rattachements lisibles" on public.sanctions_constit_elus for select using (true);

alter table public.sanctions_constit add column if not exists etiquette text;  -- « Divers droite », citée par la décision
