# PostHog deleted-users workflow

When someone deletes their Frapp account, the API sends one `account-deleted` event to PostHog
under the account's pseudonymous id, and waits for PostHog to accept it before it deletes the
Supabase Auth account ([`data-retention.md` § Individual Account Deletion](../../spec/behavior/data-retention.md#individual-account-deletion)).
That event only says the deletion was asked for. This workflow, inside PostHog, does the deleting:
it removes the person with that id, their events, and their session recordings.

Tracked by [#709](https://github.com/pdcarlson/Frapp/issues/709). Built and turned on 2026-11-06.

## Where it lives

| What | Value |
| --- | --- |
| PostHog project | `569878` "Frapp production" (org Signet, US Cloud). Staging sends nothing to PostHog, so staging has no workflow ([`ENV_REFERENCE.md`](../internal/environment/ENV_REFERENCE.md), `POSTHOG_API_KEY` row) |
| Workflow | [Delete data for deleted accounts](https://us.posthog.com/project/569878/workflows/01a1b2cc-932d-0000-0d58-7025ccd41ba4/workflow), id `01a1b2cc-932d-0000-0d58-7025ccd41ba4` |
| Trigger | Event `account-deleted`, every occurrence, test-account filter off |
| Step | HTTP Webhook (`template-webhook`): `POST https://us.posthog.com/api/projects/569878/persons/bulk_delete/` with body `{"distinct_ids": ["{event.distinct_id}"], "delete_events": true, "delete_recordings": true}`. On error: abort. Log responses: on |
| Credential | The step's **Secret headers**: `Authorization: Bearer <personal API key>`. Encrypted by PostHog, hidden after saving, kept out of the logs |
| Key owner | Paul. Personal API key `frapp-deleted-users`, limited to project "Frapp production", one scope: **Person: Write** |

The API service never holds this key. The capture channel it uses is write-only by design
(`apps/api/src/infrastructure/analytics/posthog-config.ts`), and a personal key in the API's
environment would let it read the whole dataset.

## When it breaks

- **The key stops working.** A rotated or revoked key, or Paul leaving the org, makes every run
  fail with a 401 or 403. Deletions then report success in the app while the data stays. To fix,
  create a new key as above, then use **Replace** on the step's `Authorization` secret header and save.
- **To see failures**, open the workflow's logs in PostHog, or over the PostHog MCP use
  `workflows-list-invocations` and then `workflows-logs` on the workflow id.
- **A deletion that ran while the workflow was off or broken** is not retried. Find the ids it
  missed with SQL, then delete them by hand (`persons-bulk-delete` over the MCP, with
  `delete_events` and `delete_recordings`):

  ```sql
  SELECT DISTINCT distinct_id FROM events
  WHERE event = 'account-deleted' AND timestamp >= '<when it broke>'
  ```

## What it can't delete

`bulk_delete` finds **persons**. A pseudonym with no person profile gets
`"persons_found": 0` and nothing is queued, even with `delete_events` set (seen on the
2026-11-06 key check below). A person exists once web or mobile calls `identify` with the
pseudonym, or once the API sends an event carrying a chapter group. The API's other events are
personless (`$process_person_profile: false`) and attribute to an existing person with that id
without creating one (`captureEvent` in `apps/api/src/infrastructure/analytics/posthog-runtime.ts`).
So the gap is an account whose every event was personless: no client session with analytics on
and no chapter-scoped event. The end-to-end check below settles whether personless events go
with the person.

## Re-creating it

Build the workflow through the PostHog MCP (`workflows-create`) with the trigger and step in
[Where it lives](#where-it-lives), then add the secret header in the dashboard; the MCP never
sees the key. It is created as a draft. Check it with `workflows-test-run` on the
`delete_person` step: with `mock_async_functions` on, the log shows the request it would send;
with it off, against an id that matches no one, a working key answers `202` with
`persons_found: 0`. Then turn it on with `workflows-enable`.

## Verification

- **2026-11-06, key check:** a real run of the step against a made-up id returned `202`
  `{"persons_found": 0, ..., "deletion_errors": []}`, so the key is accepted with the scope it
  needs. No `account-deleted` events existed yet, so there was nothing to clean up afterwards.
- **End to end: not yet done.** It needs production sending to PostHog (the deploy after
  2026-11-06), then a throwaway account that signs in on a client, does a few things, and is
  deleted in the app. Pass: one workflow run with a `202` naming one person, and once PostHog's
  deletion job has run (it is asynchronous and can take days),
  `SELECT count() FROM events WHERE distinct_id = '<pseudonym>'` returns 0.
