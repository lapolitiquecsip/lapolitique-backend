# Legislative data pipeline

The canonical legislative model lives in Supabase and is populated only by official records.

## Deployment order

1. Apply `supabase/migrations/20260630_legislative_reliability.sql`.
2. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally `DEEPSEEK_API_KEY`.
3. Run `npm run discover-datagouv-sources` to verify the pinned data.gouv.fr catalog entries.
4. Backfill in this order:
   - `npm run automation:laws`
   - `npm run automation:senate`
   - `npm run automation:senate:amendments`
   - `npm run automation:votes`
   - `npm run automation:senate:scrutins`
   - `npm run automation:jorf`
   - `npm run automation:legislative:summaries`
5. Enable `legislative-sync.yml` and `jorf-sync.yml` after checking the first run in `legislative_sync_runs`.

The 30-minute workflow refreshes Assembly dossiers, Senate workflow records, scrutin results, and amendment votes. The daily JORF workflow is the only process allowed to create `promulgated_laws` records.

## Data invariants

- A text is not promulgated unless a DILA JORF record has `NATURE=LOI` and matches the official dossier title.
- Importers use official identifiers and `upsert`; rerunning the same archive must not create duplicates.
- `legislative_analyses` contains generated prose only. It cannot change authors, dates, statuses, votes, or categories.
- Failed generation leaves the public message “Analyse indisponible”; no synthetic fallback is stored.
- Premium analyses are protected by Supabase RLS. UI hiding is not a security control.

## Operational checks

`npm run automation:legislative:reconcile` fails after two consecutive pipeline failures. It also reports active dossiers whose source verification is older than 45 minutes. Every importer writes a row to `legislative_sync_runs` for audit and alerting.
