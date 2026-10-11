-- Journal de bord des cycles d'agents.
--
-- Un « cycle » est une chaîne d'agents spécialisés qui se passent le relais : l'un détecte
-- (parution d'un programme, tenue d'une audition), le suivant collecte, un autre rédige, un
-- autre vérifie, le dernier met en ligne. Chaque objet suivi a UNE ligne ici, qui dit où il
-- en est et pourquoi il n'avance pas. Sans ce journal, un objet que la source a refusé de
-- servir (503, compte rendu absent) disparaissait sans laisser de trace.
--
-- Cette table n'est lue par aucune page du site : c'est un outil de pilotage.
create table if not exists public.cycle_items (
  cycle text not null,                 -- programmes | auditions
  cle text not null,                   -- identifiant stable : adresse de la source, référence du compte rendu…
  etape text not null,                 -- detecte | collecte | redige | verifie | en_ligne | a_transcrire | sans_source | ecarte | a_revoir
  sujet text,                          -- candidat (slug) ou commission
  titre text,
  source_url text,
  date_objet date,                     -- date de la réunion, de la parution
  donnees jsonb not null default '{}'::jsonb,   -- empreinte, brouillon, motifs de rejet…
  tentatives int not null default 0,
  erreur text,
  agent text,                          -- dernier agent à avoir touché la ligne
  alerte_le timestamptz,               -- une alerte par blocage, pas une par passage
  detecte_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  en_ligne_le timestamptz,
  primary key (cycle, cle)
);
create index if not exists cycle_items_etape on public.cycle_items (cycle, etape);

-- Réservée aux tâches de fond (clé de service) : aucune politique de lecture publique.
alter table public.cycle_items enable row level security;
