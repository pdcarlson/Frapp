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

Create **one automation with both triggers** (Cursor supports multiple triggers per automation):

| Trigger | Why |
|---------|-----|
| GitHub → **Pull request merged**, repo `Frapp` | Audits the freshly-landed state once per merge. No wasted runs on idle days; bursts covered per-merge. |
| **Schedule** → weekly (e.g. Wed 09:00 EDT) | Safety net for time-based drift (dependency CVEs, staleness) not tied to any PR. |

Dedup (below) makes the two triggers safe to overlap — the weekly run won't re-file what a merge run already filed.

### The prompt (paste into the automation's Agent Instructions)

The prompt is deliberately thin and defers to the skill, so future tuning happens in the
version-controlled `.cursor/skills/suggestion-triage.md` without re-pasting the dashboard.

```text
You are the Suggestion Triage agent for the Frapp repository. On each run, perform a BROAD,
repo-wide product and engineering review and file the findings as deduplicated GitHub issues.
Do not modify code or open pull requests.

This is NOT a review of the most recent PR. If a merged PR triggered you, treat it as just one
small signal — look across the whole codebase, the product spec (spec/), and the user
experience. Cover three lenses: (1) engineering gaps, (2) product & behavior gaps grounded in
spec/product.md and spec/behavior.md, and (3) creative next steps & research. Be generalized
and inventive, not narrow.

Follow .cursor/skills/suggestion-triage.md EXACTLY — it defines the lenses, the balance rules
(span multiple areas; at most ~2 findings from recently-changed files; include product/UX/
research items; ~6–10 total), the labels, the issue template, the dedup rule, and how to
create/search issues with the gh CLI (run `export GH_TOKEN="$GITHUB_PAT"` first).

Before filing, skim existing open `suggestion` issues to avoid duplicates and to find
under-covered domains. Report findings grouped by severity. If nothing new is found, take no
action.
```


---

## Settings (every option, set in the dashboard)

| Setting | Value | Notes |
|---------|-------|-------|
| Repository | `pdcarlson/Frapp` | |
| Branch | `main` | Source the audit runs against. |
| Trigger | see table above | One per automation. |
| Model | a high-reasoning model | Audit quality scales with reasoning; pick the strongest available. |
| Tools / integrations | none required beyond shell | The agent creates/searches issues with `gh` CLI (repo convention — see below). Disable code edits / branch pushes. |
| Auto-create PR | **off** (`autoCreatePR: false`) | This flow files issues, never code changes. |
| Secrets / env | `GITHUB_PAT` Cursor env secret = fine-grained PAT, **Issues: read/write** on `pdcarlson/Frapp` | ⚠️ Cursor pre-auths `gh` as its own GitHub App, which 403s on label/issue writes (`Resource not accessible by integration`). The skill runs `export GH_TOKEN="$GITHUB_PAT"` + `gh api user` to force/verify the PAT (`gh` doesn't read `GITHUB_PAT` directly). `GITHUB_PAT` is distinct from Cursor's injected `GITHUB_TOKEN`. **Not** in the repo. |
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
| `area:web` / `area:api` / `area:db` / `area:deps` / `area:security` / `area:ci` / `area:docs` | `#0969da` | Engineering areas. |
| `area:product` / `area:ux` / `area:research` | `#a371f7` | Product gaps, behavior/UX gaps, and forward-looking research/next-steps. |
| `severity:critical` / `severity:high` / `severity:medium` / `severity:low` | `#d1242f → #d4a72c` | Priority / impact (also used to rank `type:idea` items). |
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
      "name": "Suggestion Triage",
      "repo": "pdcarlson/Frapp",
      "branch": "main",
      "triggers": [
        { "type": "github.pull_request.merged", "repo": "Frapp", "by": "anyone" },
        { "type": "schedule", "cron": "0 9 * * 3", "tz": "America/New_York" }
      ],
      "model": "gpt-5.5-high",
      "autoCreatePR": false,
      "memory": true,
      "secrets": { "GITHUB_PAT": "fine-grained PAT, Issues:read+write on pdcarlson/Frapp" },
      "issueCreation": "gh CLI (export GH_TOKEN=$GITHUB_PAT) — repo convention, no MCP",
      "promptRef": "docs/internal/CURSOR_AUTOMATIONS.md#the-prompt-paste-into-the-automations-agent-instructions",
      "behaviorRef": ".cursor/skills/suggestion-triage.md"
    }
  ]
}
```

---

## How to create it (dashboard)

1. Go to `cursor.com/automations` → **New automation**.
2. Add **both triggers** via **Add Trigger**: GitHub *Pull request merged* (repo `Frapp`, by Anyone) and *Schedule* weekly (e.g. Wed 09:00 EDT).
3. Select repo `pdcarlson/Frapp`, branch `main`, and a high-reasoning model (e.g. GPT-5.5 High).
4. Paste the prompt above into **Agent Instructions**.
5. Add the `GITHUB_PAT` env secret (fine-grained PAT, Issues read/write on `pdcarlson/Frapp`). The agent creates/searches issues + labels via `gh` CLI. **Note:** Cursor auto-authenticates `gh` as its own GitHub App, which 403s on writes — the skill forces the PAT with `export GH_TOKEN="$GITHUB_PAT"` and verifies via `gh api user`. No MCP server needed. Leave PR creation / code edits off.
6. Turn on **Memory**, toggle **Active**, and **Create**.

> Note: the agent reads `.cursor/skills/suggestion-triage.md` from `main` at run time. Until this branch is merged to `main`, point the automation's branch at `claude/cursor-suggestion-triage` or the skill won't be present.

## Verify

- Click **Run**. Confirm it opens issues titled `[suggestion] …` with `suggestion` + `area:*` + `severity:*` labels and the body template incl. the hidden `fp=` marker.
- **Run it again.** Confirm it creates **no duplicates** (dedup works).
- Confirm the schedule trigger shows a next-run time.

## Maintenance

- Behavior changes go in [`.cursor/skills/suggestion-triage.md`](../../.cursor/skills/suggestion-triage.md); only re-paste the dashboard prompt if the prompt itself changes.
- Keep the label list aligned with `AGENTS.md`.
- See the environment notes in [`spec/environments.md`](../../spec/environments.md#cursor-automations-environment).
