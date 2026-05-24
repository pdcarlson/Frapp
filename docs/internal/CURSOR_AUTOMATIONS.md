# Cursor Automations

Canonical, version-controlled spec for Frapp's Cursor Automations. Cursor configures automations
in its **dashboard only** (config-as-code is not supported yet — it's an open feature request), so
this file is the source of truth you copy into the dashboard. Keep it in sync when you change the
automation.

The behavior the agent must follow lives in [`.cursor/skills/suggestion-triage.md`](../../.cursor/skills/suggestion-triage.md);
the dashboard prompt is intentionally thin and defers to that skill.

---

## Why Cursor (not the Jules API)

The original idea was to read Jules' **Suggestions (BETA)** panel via API and file the findings as
issues. The Jules public REST API (`https://jules.googleapis.com/v1alpha`) only exposes `sources`,
`sessions`, and `sessions.activities` — there is **no suggestions endpoint** (verified against
Google's API discovery document). The panel is web-UI-only and authenticated by the browser session,
not the API key.

Cursor Automations give the same outcome with infra Frapp already uses (`.cursor/` rules + skills):
a cloud agent runs on a schedule/event, audits the repo in a fresh sandbox, and files GitHub issues —
**no GitHub Actions, no `gh` script, no `JULES_USER_API_KEY`**.

---

## Automation: "Suggestion Triage"

Create **two automations that share the same prompt** (each automation has a single trigger):

| # | Name | Trigger | Why |
|---|------|---------|-----|
| 1 | `Frapp — Suggestion Triage (on merge)` | GitHub → **Pull request merged**, base `main` | Audits the freshly-landed state once per merge. No wasted runs on idle days; bursts covered per-merge. |
| 2 | `Frapp — Suggestion Triage (weekly)` | **Schedule** → weekly (e.g. Mon 09:00) | Safety net for time-based drift (dependency CVEs, staleness) not tied to any PR. |

Dedup (below) makes the two safe to overlap — the weekly run won't re-file what the merge runs already filed.

### The prompt (paste verbatim into both automations)

```text
You are the Suggestion Triage agent for the Frapp repository. Audit the codebase for
high-value improvements and file them as deduplicated GitHub issues. Do not modify code or
open pull requests. Follow .cursor/skills/suggestion-triage.md exactly.

When invoked:
1. Focus on recently changed and high-risk areas. Run the useful project checks:
   npm run check-types, npm run lint, npm audit, npm run check:api-contract,
   npm run check:migration-safety.
2. Find concrete, actionable suggestions across: testing gaps, code health, performance,
   security, dependencies, API-contract drift, DB/migration safety, CI/CD. At most ~8
   high-impact findings — prefer signal over noise.
3. For each finding capture: title, area, severity, location (path:line), description,
   rationale/impact, a code-context snippet, and a suggested fix.
4. Deduplicate: compute the fingerprint (area + slug(title) + primary file, no line number)
   and search existing issues (open AND closed) labeled `suggestion` for that fingerprint.
   Skip the finding if a match already exists.
5. Create one GitHub issue per new finding using the body template and labels defined in the
   skill (`suggestion`, `area:<x>`, `severity:<x>`; add `agent-ready` when fully specified).
   Include the hidden fingerprint marker in the body.

Report findings grouped by severity (Critical / High / Medium / Low). If nothing new is
found, take no action.
```

---

## Settings (every option, set in the dashboard)

| Setting | Value | Notes |
|---------|-------|-------|
| Repository | `pdcarlson/Frapp` | |
| Branch | `main` | Source the audit runs against. |
| Trigger | see table above | One per automation. |
| Model | a high-reasoning model | Audit quality scales with reasoning; pick the strongest available. |
| Tools / integrations | **Create Issue** (GitHub); optionally **Comment on Pull Request** | Disable code edits / branch pushes. |
| Auto-create PR | **off** (`autoCreatePR: false`) | This flow files issues, never code changes. |
| MCP servers | **GitHub MCP** (for reliable issue create + search of open/closed issues) | See token below. Cursor's native GitHub integration handles PRs/comments; issue search+create is most reliable via GitHub MCP. |
| Secrets / env | `GITHUB_TOKEN` scoped to **Issues: read/write** on `pdcarlson/Frapp` | Stored in the automation's dashboard secrets, **not** in the repo. Fine-grained PAT preferred. |
| Memory | **on** | Lets the agent learn what it already filed. |
| Network access | default | Audit is local to the sandbox; `npm audit` needs registry access. |
| Sandbox setup | from [`.cursor/environment.json`](../../.cursor/environment.json) (`npm install`) | Makes lint/typecheck/`npm audit` available. |
| Slack summary | off (optional) | Enable later if you want a digest posted to a channel. |

---

## Labels

Create these once (the agent will create any missing label on first run; colors are a suggestion):

| Label | Color | Meaning |
|-------|-------|---------|
| `suggestion` | `#8250df` | Filed by suggestion triage — the dedup/lifecycle anchor. |
| `area:web` / `area:api` / `area:db` / `area:deps` / `area:security` / `area:ci` / `area:docs` | `#0969da` | Which part of the system. |
| `severity:critical` / `severity:high` / `severity:medium` / `severity:low` | `#d1242f → #d4a72c` | Priority. |
| `agent-ready` | `#1a7f37` | Fully specified, safe to hand to an agent (existing label, see `AGENTS.md`). |

---

## Deduplication

Each finding carries a stable fingerprint anchored to values that survive edits:

```
fp = <area>/<slug(title)>      file=<primary-file-path>      (no line number — lines drift)
```

It's embedded in every issue body as a hidden marker:

```html
<!-- cursor-suggestion: v1 fp=<area>/<slug> file=<primary-file-path> -->
```

Before creating an issue the agent searches **open and closed** `label:suggestion` issues for the
`fp=` string and skips on any match — so re-runs (and the merge-vs-weekly overlap) never duplicate.
Full rules: [`.cursor/skills/suggestion-triage.md`](../../.cursor/skills/suggestion-triage.md).

---

## Machine-readable descriptor (for future config-as-code / Cursor API)

Cursor does **not** import this today — it's documentation and a head-start for the
[config-as-code feature request](https://forum.cursor.com/t/config-as-code-for-automations/154831)
or programmatic creation via the Cursor agents API. Keep it consistent with the table above.

```json
{
  "automations": [
    {
      "name": "Frapp — Suggestion Triage (on merge)",
      "repo": "pdcarlson/Frapp",
      "branch": "main",
      "trigger": { "type": "github.pull_request.merged", "baseBranch": "main" },
      "model": { "reasoning": "high" },
      "tools": ["github.createIssue", "github.searchIssues"],
      "autoCreatePR": false,
      "memory": true,
      "mcpServers": { "github": { "scope": "issues:read,issues:write" } },
      "promptRef": "docs/internal/CURSOR_AUTOMATIONS.md#the-prompt-paste-verbatim-into-both-automations",
      "behaviorRef": ".cursor/skills/suggestion-triage.md"
    },
    {
      "name": "Frapp — Suggestion Triage (weekly)",
      "repo": "pdcarlson/Frapp",
      "branch": "main",
      "trigger": { "type": "schedule", "cron": "0 9 * * 1" },
      "model": { "reasoning": "high" },
      "tools": ["github.createIssue", "github.searchIssues"],
      "autoCreatePR": false,
      "memory": true,
      "mcpServers": { "github": { "scope": "issues:read,issues:write" } },
      "promptRef": "docs/internal/CURSOR_AUTOMATIONS.md#the-prompt-paste-verbatim-into-both-automations",
      "behaviorRef": ".cursor/skills/suggestion-triage.md"
    }
  ]
}
```

---

## How to create it (dashboard)

1. Go to `cursor.com/automations` → **New automation** (or start from the "Code review" / "Bug monitor" template and replace the prompt).
2. Pick the trigger (automation #1: GitHub Pull request merged on `main`; automation #2: Schedule weekly).
3. Select repo `pdcarlson/Frapp`, branch `main`, and a high-reasoning model.
4. Paste the prompt above.
5. Under tools/integrations, enable **Create Issue**; connect the **GitHub MCP** server and add the `GITHUB_TOKEN` secret (Issues read/write). Leave PR creation / code edits off.
6. Turn on **Memory**. Create the automation.
7. Repeat for the second automation (same prompt, schedule trigger).

## Verify

- Click **Run** on automation #1. Confirm it opens issues titled `[suggestion] …` with `suggestion` + `area:*` + `severity:*` labels and the body template incl. the hidden `fp=` marker.
- **Run it again.** Confirm it creates **no duplicates** (dedup works).
- Confirm automation #2 shows a scheduled next-run time.

## Maintenance

- Behavior changes go in [`.cursor/skills/suggestion-triage.md`](../../.cursor/skills/suggestion-triage.md); only re-paste the dashboard prompt if the prompt itself changes.
- Keep the label list aligned with `AGENTS.md`.
- See the environment notes in [`spec/environments.md`](../../spec/environments.md#cursor-automations-environment).
