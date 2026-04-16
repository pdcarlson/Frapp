# Bugbot Review Runbook

## Goal

Ensure pull requests targeting `main` and `production` are reviewed by Cursor Bugbot, with `production` remaining the strict promotion gate.

## Review policy in this repo

- `main`: Bugbot should review every PR, but its findings are advisory.
- `production`: Bugbot should review every promotion PR and its status check should be required alongside the existing approval and conversation-resolution rules.

This preserves the current solo-developer workflow on feature PRs while keeping promotions strict.

## How Bugbot should be configured

### Cursor dashboard

Verify these settings in the Bugbot dashboard:

1. Bugbot is enabled for `https://github.com/pdcarlson/Frapp`
2. Learned rules are enabled if you want Bugbot to keep adapting from review history
3. There is only one active Cursor GitHub App installation for this repository/account

### Repo-tracked rules

Bugbot reads checked-in project rules from `.cursor/BUGBOT.md` files. This repo uses:

- `.cursor/BUGBOT.md` — repo-wide review expectations
- `apps/api/.cursor/BUGBOT.md`
- `apps/web/.cursor/BUGBOT.md`
- `apps/mobile/.cursor/BUGBOT.md`
- `packages/.cursor/BUGBOT.md`
- `.github/workflows/.cursor/BUGBOT.md`
- `supabase/migrations/.cursor/BUGBOT.md`

Bugbot always includes the root file and then adds nested files while traversing upward from changed paths.

### Rule precedence

Bugbot merges rules in this order:

1. Team rules
2. Repository rules (manual and learned dashboard rules)
3. Project `BUGBOT.md` files, including nested files
4. User rules

Because this project is currently maintained solo, the checked-in `BUGBOT.md` files should remain the durable source of truth for repo-specific expectations.

## Triggering reviews

### Preferred behavior

Bugbot should auto-review PRs targeting:

- `main`
- `production`

This repo also keeps a lightweight GitHub Actions fallback that posts `cursor review` on PR lifecycle events for `main` and `production`. That preserves deterministic review coverage for a solo-maintainer workflow without relying exclusively on native auto-trigger behavior.

### Manual trigger

If Bugbot does not run automatically, add a **top-level PR comment** with one of:

- `bugbot run` — **preferred**. Does not contain the substring "cursor", so it cannot be confused with `@cursor` / `@cursoragent` background-agent mentions (see the footgun callout below).
- `cursor review` — legacy alias; still works.

For deeper troubleshooting, use:

- `bugbot run verbose=true`
- `cursor review verbose=true`

Trigger phrases work only as **top-level** PR comments, not as replies inside an existing review thread.

### ⚠ Background-agent footgun

The Cursor GitHub app exposes two very different things that react to comments:

1. **Bugbot** — the AI code reviewer. Triggered by `bugbot run` or `cursor review`.
2. **Cursor background agents** — full cloud agents that spin up and start working on a PR. Triggered by `@cursor` or `@cursoragent` mentions.

The `Trigger Bugbot Review` workflow in this repo uses `bugbot run` specifically to avoid collision with the `@cursor` mention. **Do not type `@cursor` or `@cursoragent` in a PR comment** unless you explicitly want to spawn a paid background agent over the PR diff. An incident in April 2026 burned ~$50 in agent tokens when a conversational `@cursoragent` comment was posted on a stale feature branch.

Safe patterns:

- `bugbot run` → re-trigger Bugbot on the current PR head.
- `@cursor remember [fact]` → teach Bugbot a learned rule (cheap; does not spawn a background agent).

### Dashboard settings we rely on

These settings live in the [Bugbot dashboard](https://cursor.com/dashboard/bugbot) / personal settings and cannot be checked in. Keep them aligned with the behavior this runbook documents:

| Setting | Required value | Why |
|---|---|---|
| Run only when mentioned | **Off** | We want Bugbot to auto-review PRs targeting `main` and `production`. |
| Run only once per PR | **Off** | We want Bugbot to re-review on every push; the workflow trigger already fires on `synchronize`. |
| Enable reviews on draft PRs | Off | The workflow gates on `github.event.pull_request.draft == false`. |
| Autofix | Team preference | Per Cursor docs, "Manual" still spawns a cloud agent to prepare the fix. If that surprises you, set this to **Off**. |

If any of these drift, Bugbot's behavior will visibly diverge from this runbook — file a follow-up to either adjust the dashboard or update this table.

### Teaching Bugbot

You can add a learned rule from a PR by commenting:

```text
@cursor remember [fact]
```

Use that for evolving preferences that do not belong in checked-in `BUGBOT.md` files.

## Verifying the migration

On a fresh PR to `main`:

1. Confirm Bugbot reviews the PR automatically, or responds to `cursor review`
2. Confirm only Bugbot review activity appears on the PR
3. Confirm no legacy third-party review workflow runs
4. Confirm the new `Trigger Bugbot Review` workflow succeeds

On a fresh PR from `main` to `production`:

1. Confirm Bugbot reviews the PR
2. Confirm the Bugbot status check is present
3. Confirm the PR remains blocked until:
   - all required checks pass
   - Bugbot status succeeds
   - one approval is present
   - conversations are resolved

## Troubleshooting

### “Bugbot is disabled for this repository”

Check:

1. Bugbot is enabled for the repo in the Cursor dashboard
2. There is only one Cursor GitHub App installation for the repo/account
3. The PR was opened after the latest dashboard/app changes

If needed, use `cursor review verbose=true` on the PR and inspect the request details in Cursor support tooling.

### Bugbot check name is missing from branch protection

Bugbot must run on the repository before its check name can be selected in GitHub branch protection.

If the check does not appear:

1. Trigger Bugbot on a fresh PR
2. Record the exact emitted check name from GitHub
3. Update `scripts/configure-branch-protection.mjs` if the check name changed
4. Re-apply branch protection

### Auto-review is unreliable

If native auto-review stops being dependable, first verify:

1. Repository enablement in the Bugbot dashboard
2. Cursor GitHub App installation health
3. Manual trigger behavior using `cursor review`
4. The `Trigger Bugbot Review` workflow succeeds on PR lifecycle events

If Bugbot begins reliably auto-reviewing without help, you can consider removing the workflow fallback in a future cleanup PR. Until then, keep the fallback documented here so review coverage on `main` and `production` remains predictable.
