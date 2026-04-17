# Bugbot Review Runbook

## Goal

Pull requests targeting `main` and `production` get an AI review from Cursor Bugbot. Reviews are **advisory on both branches** — Bugbot does not gate merges.

## Review policy in this repo

- Bugbot findings are advisory everywhere. Address them if useful; ignore if not.
- No GitHub Actions workflow wraps Bugbot. This repo deliberately does **not** have a `bugbot-review` required status check on any branch. An earlier `trigger-bugbot-review.yml` workflow was removed because its polling loop hung for ~10 minutes on every PR synchronize event without reliably matching Bugbot's actual output.
- Promotion to `production` is already gated by branch protection (CI checks + the `branch-policy` check + approval + conversation resolution). Bugbot layered on top was unnecessary for a solo-maintainer workflow.

## How Bugbot is configured

### Cursor dashboard

Verify in [cursor.com/dashboard/bugbot](https://cursor.com/dashboard/bugbot):

1. Bugbot is enabled for `https://github.com/pdcarlson/Frapp`.
2. There is exactly one active Cursor GitHub App installation for this repository/account.
3. Personal/team settings (keep aligned with this runbook):

   | Setting | Value | Why |
   |---|---|---|
   | Run only when mentioned | **Off** | We want Bugbot to auto-review every PR to `main` and `production`. |
   | Run only once per PR | **Off** | Re-review on every push. |
   | Enable reviews on draft PRs | Off | Bugbot only reviews once a PR is marked ready. |
   | Autofix | Team preference | Per Cursor docs, "Manual" still spawns a cloud agent to prepare the fix. Set to **Off** if that surprises you. |

### Repo-tracked rules

Bugbot reads checked-in project rules from `.cursor/BUGBOT.md` files. This repo uses:

- `.cursor/BUGBOT.md` — repo-wide review expectations
- `apps/api/.cursor/BUGBOT.md`
- `apps/web/.cursor/BUGBOT.md`
- `apps/mobile/.cursor/BUGBOT.md`
- `packages/.cursor/BUGBOT.md`
- `.github/workflows/.cursor/BUGBOT.md`
- `supabase/migrations/.cursor/BUGBOT.md`

Bugbot merges rules in this order: team rules → repository rules (manual + learned dashboard rules) → project `BUGBOT.md` files (root first, then nested) → user rules.

## Triggering reviews

### Automatic

Bugbot auto-reviews PRs targeting `main` and `production` when the PR is marked ready for review, as long as the dashboard settings above are correct.

### Manual trigger

If Bugbot doesn't auto-run, post a **top-level PR comment** with one of:

- `bugbot run` — preferred. Does not contain the substring "cursor", so it cannot be confused with `@cursor` mentions.
- `cursor review` — legacy alias; still works.

For verbose troubleshooting output: append ` verbose=true`.

Trigger phrases only work as top-level comments, not as replies inside an existing review thread.

### ⚠ Background-agent footgun

The Cursor GitHub app exposes two very different things:

1. **Bugbot** — the AI code reviewer. Triggered by `bugbot run` or `cursor review`.
2. **Cursor background agents** — full cloud agents that start working on a PR. Triggered by `@cursor` or `@cursoragent` mentions.

**Do not type `@cursor` or `@cursoragent` in a PR comment** unless you explicitly want to spawn a paid background agent. An incident in April 2026 burned ~$50 in agent tokens when a conversational `@cursoragent` comment was posted on a stale feature branch.

Safe learned-rule pattern: `@cursor remember [fact]` → adds a learned rule to Bugbot's rule store. Cheap; does not spawn a background agent.

## Troubleshooting

### "Bugbot didn't review my PR"

1. Confirm the PR was marked **ready for review** (Bugbot auto-review skips drafts by default).
2. Check the Cursor dashboard settings above.
3. Post `bugbot run` as a top-level comment.
4. If that still doesn't trigger, append `verbose=true` (`bugbot run verbose=true`) and inspect the request details in Cursor support tooling.

### "Bugbot is disabled for this repository"

1. Verify the repo is enabled in the Cursor dashboard.
2. Confirm there is only one Cursor GitHub App installation for the repo/account.
3. Confirm the PR was opened after the latest dashboard/app changes.

### Bringing a gated workflow back

If you later decide you want Bugbot to act as a required gate (not recommended for this solo-dev workflow), the prerequisites are:

1. Identify Bugbot's actual emitted check-run name against a real PR (it varies; don't assume).
2. Add **Bugbot's own check name** (not ours) to the production required contexts in `scripts/configure-branch-protection.mjs`.
3. Re-run `npm run configure:branch-protection`.

Do **not** re-add the old `trigger-bugbot-review.yml` polling workflow — it was unreliable and hung CI for ten minutes per event.
