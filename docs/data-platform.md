# Data platform deployment

Supabase is the canonical store. GitHub Actions is the only production scheduler; the Express process and Inngest do not own cron triggers.

## Deploy

1. Apply `supabase/migrations/20260701_data_platform.sql` after the legislative migrations.
2. Configure repository secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `DEEPSEEK_API_KEY`.
3. Run **Full data rebuild** with `mode=dry-run` for each domain.
4. Run it again with `mode=backfill`, starting with `territories`, then `officials`, `government`, `state-budget`, and `legislation`.
5. Check `ingestion_runs`, `data_quality_issues`, and `public_data_freshness(null)` before enabling scheduled workflows.

## Safety rules

- Importers use official identifiers and upserts. They never clear a canonical table before loading.
- Empty, unavailable, or structurally invalid resources fail the run and preserve the last published data.
- `INGESTION_MODE=dry-run` validates and counts rows without publishing them.
- Generated legislative analyses are editorial records; they cannot update official facts.
- Political promises require an approved `editorial_reviews` record and a published assessment before public RPCs return them.

## Operations

- `npm run data:register-sources`: seed/update the official source registry.
- `npm run data:sync-territories`: publish compiled official territorial values.
- `npm run data:sync-rne`: discover and import current RNE resources.
- `npm run data:sync-government`: import the latest DILA government protocol.
- `npm run data:sync-state-budget`: import official 2024 execution, 2025 LFI and 2026 PLF mission values.
- `ELECTION_ID=2026_muni_t2 npm run data:sync-elections`: stream and aggregate official polling-station results by commune.
- `npm run data:reconcile`: record stale sources and fail after two consecutive source failures.

Do not re-enable `startWorkers()` or add Inngest cron triggers. Add new recurring work as a GitHub Actions workflow with `concurrency`, `workflow_dispatch`, a timeout, and a dry-run input.
