# PR review Aug 21: CI/CD & docs-governance hardening sprint (12 PRs)

**Twelve PRs merged today (#1163-#1181), all infra/docs/agent-routine work, zero product surface touched.** This is a distinct sprint from the Signet UI cutover — it hardens the engineering substrate the cutover will run on top of.

**What shipped:**
- **Fixed the actual production outage:** `frapp-api-staging` had been failing to deploy on 67 consecutive pushes (`update_failed`, invisible because `api-docker-build` stayed green). Root cause: the Dockerfile only copied root `node_modules/`, so `colorjs.io` and `zod` silently vanished from the image once npm stopped hoisting them. Fixed, plus a new CI gate that boots the built image and probes `/health` — building an image no longer proves it can run (#1170).
- **`web-responsive-floor` (375px floor) is now a real required gate**, split out of the advisory visual-regression job it used to share by accident (#1169).
- **PR auto-update from behind `main` actually works now.** `pr-base-sync` had never fired in its life — the token secret was never created. Replaced with a GitHub App installation token; proven end-to-end mid-review when it auto-updated PR #1172 itself and CI went green on the bot's own commit (#1171, #1172).
- **Docs stopped lying by construction.** The docs-sync gate only checked that *some* file under `docs/`/`spec/` changed, so PRs padded it with filler ("Maintenance Log" notes) instead of fixing the doc they'd actually invalidated. Fixed the incentive, fixed 6+ real drifted tables (CI job rosters missing `@repo/theme`, `@repo/formatting`, `chat-integrations`), and added `check-doc-tables` + promoted `doc-paths` to required so this can't silently recur (#1176, #1179).
- **New routine: Docs Upkeep** — 4th Claude routine, weekly, sweeps 1/5 of all tracked docs and *fixes* drift instead of filing an `area:docs` issue nobody works (over half of all `area:docs` issues ever filed are still open) (#1177).
- **Cloud sandboxes can now reach deployed staging** (api/web/landing + hosted Supabase, production explicitly excluded on both apexes) and a capability-probe manifest tells a fresh session what it can verify live instead of finding out by failing mid-task (#1178).
- Smaller: routine model/connector/autofix settings corrected in ROUTINES.md (#1180, #1181); analytics provider selection now logs which backend is live, catching the still-open PostHog gap (#1174); Issue Triage self-maintenance fixes (#1163).

**Net effect:** CI required-check set went from drifted/undocumented to self-verifying. Deploy pipeline that was 100% broken for 4 days is fixed and now gated. Docs debt has a weekly repair mechanism instead of a filing mechanism nobody clears.

**Still open, human-only (nobody can do these from an agent session):**
- **#1166** — re-run `npm run configure:branch-protection` so `web-responsive-floor` actually blocks (2-min task, precondition already met: it ran green on `main`'s first try).
- **#1173** — provision a PostHog project, set `POSTHOG_API_KEY` per environment. Confirmed via #1174's new log line: analytics events are currently keyed and silently discarded on staging.
- **#862** — confirm `SENTRY_DSN` reaches Render staging and one real event lands (open since Aug 14).
- **#814** — PR Follow-ups human-action list, rolling.
- Low-priority docs debt: #1167, #1168 (both P4).

**Not part of this sprint, unchanged:** the Signet web-dashboard reskin (#920) — see the new blob below. This is the next big workload.