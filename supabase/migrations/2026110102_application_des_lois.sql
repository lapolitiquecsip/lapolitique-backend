-- Application des lois (01/11/2026) : les décrets attendus par chaque loi, tirés du baromètre
-- de l'Assemblée nationale (LexImpact, licence ouverte), relevé par sync-application-lois.ts.
-- Données publiques : lecture libre ; l'outil complet et les alertes sont réservés au Pro côté site.

create table if not exists public.application_lois (
  jorf_id            text primary key,          -- JORFTEXT… = promulgated_laws.jorf_id
  titre              text not null,
  publiee_le         date,
  dossier_legifrance text,
  dossier_an         text,
  dossier_senat      text,
  commission         text,
  legislature        integer,
  gouvernement       text,
  sans_echeancier    boolean default false,
  application_directe boolean default false,
  nb_mesures         integer default 0,         -- à appliquer, hors « sans objet »
  nb_appliquees      integer default 0,
  nb_attente         integer default 0,
  nb_retard          integer default 0,         -- en attente, échéance dépassée, hors publications « éventuelles »
  maj_le             timestamptz not null default now()
);
create index if not exists application_lois_publiee_idx on public.application_lois (publiee_le desc);
create index if not exists application_lois_attente_idx on public.application_lois (nb_attente) where nb_attente > 0;

create table if not exists public.application_mesures (
  loi_jorf_id   text not null references public.application_lois(jorf_id) on delete cascade,
  ordre         integer not null,
  articles      text,
  base_legale   text,
  objet         text,
  observation   text,                           -- « Publication envisagée en mars 2027 »…
  decret_id     text,                           -- JORFTEXT… du décret paru
  echeance      date,                           -- date lue dans l'observation, sinon « Date prévue »
  eventuelle    boolean default false,          -- publication simplement « éventuelle » : jamais comptée en retard
  etat          text not null,                  -- 'applique' | 'attente' | 'sans_objet'
  delai_jours   integer,
  vu_le         timestamptz not null default now(),
  applique_vu_le timestamptz,                   -- le baromètre ne date pas le décret : jour où on le voit paru
  maj_le        timestamptz not null default now(),
  primary key (loi_jorf_id, ordre)
);
create index if not exists application_mesures_etat_idx on public.application_mesures (etat, echeance);

alter table public.application_lois enable row level security;
alter table public.application_mesures enable row level security;
drop policy if exists "application_lois lecture" on public.application_lois;
create policy "application_lois lecture" on public.application_lois for select using (true);
drop policy if exists "application_mesures lecture" on public.application_mesures;
create policy "application_mesures lecture" on public.application_mesures for select using (true);

-- Suivre une loi pour être alerté de ses décrets (Pro). ref = jorf_id.
alter table public.user_suivis drop constraint if exists user_suivis_kind_check;
alter table public.user_suivis add constraint user_suivis_kind_check
  check (kind = any (array['parti','ministere','candidat','commission','amdt_texte','amdt_groupe','app_loi']));
