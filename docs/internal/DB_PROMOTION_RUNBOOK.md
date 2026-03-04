# DB Promotion Runbook (local → staging → production)

## Purpose

Use this runbook whenever `supabase/migrations/**` changes need to be promoted.

## Promotion order (never skip)

1. **Local** (`npx supabase db push --local`)
2. **Staging** (`preview` environment Supabase project)
3. **Production** (`main` environment Supabase project)

## Preflight checklist

- [ ] Migration filenames pass `npm run check:migration-safety`
- [ ] PR includes migration SQL + rollback plan (`DB_ROLLBACK_PLAYBOOK.md`)
- [ ] Query/index/policy changes reviewed by at least one backend reviewer
- [ ] Production deploy window chosen; stakeholders notified
- [ ] Supabase backups/snapshots confirmed for target environment

## Local validation

```bash
npx supabase start
npx supabase db push --local
```

Then run:

```bash
npm run test -w apps/api
npm run check:api-contract
```

## Staging promotion

```bash
npx supabase db push --project-ref <STAGING_PROJECT_REF>
```

Post-apply staging checks:

- [ ] `GET /health` returns `status: ok`
- [ ] One auth-protected API route succeeds
- [ ] Stripe staging webhook endpoint (`/v1/webhooks/stripe`) accepts signed event
- [ ] No migration-related errors in Render logs

## Production promotion

```bash
npx supabase db push --project-ref <PRODUCTION_PROJECT_REF>
```

Post-apply production checks:

- [ ] `GET /health` succeeds
- [ ] Critical API smoke tests pass (auth + chapter-scoped endpoint)
- [ ] Webhook delivery in Stripe dashboard is green
- [ ] No elevated 5xx/Sentry alerts after deploy

## Promotion guardrails

- Do not apply production migrations before staging validation.
- Do not merge migration PRs without rollback instructions.
- If any post-apply check fails, stop and execute `DB_ROLLBACK_PLAYBOOK.md`.
