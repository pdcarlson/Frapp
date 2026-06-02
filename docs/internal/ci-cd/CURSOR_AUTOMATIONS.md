# Cursor Automations

Canonical, version-controlled spec for Frapp's Cursor Automations. Cursor configures automations in its
**dashboard only** (config-as-code isn't supported yet), so this file is the source of truth you copy into
the dashboard. Keep it in sync when you change an automation.

There are **two** automations, staggered daily, both writing to **Linear** (never GitHub):

| # | Automation | Skill (behavior contract) | When |
| --- | --- | --- | --- |
| 1 | **Linear Issue Curator** | [`.cursor/skills/linear-curator.md`](../../../.cursor/skills/linear-curator.md) | daily (e.g. 08:00 ET) |
| 2 | **Linear Triage** | [`.cursor/skills/linear-triage.md`](../../../.cursor/skills/linear-triage.md) | daily, ~1h after #1 (e.g. 09:00 ET) |

The curator **creates and maintains** `suggestion` issues in Linear's **Triage** inbox. An hour later the
triage automation works **both** the **Triage inbox** (prioritize, bucket, dedup, promote to Backlog)
**and the existing Backlog** (set sane Priorities in batches — the main job, since `/next` ranks by
Priority and ignores projects — and projectify only suggestions that *clearly* fit; most stay projectless
by design) — feeding clean, ranked work to [`/next`](../../../.claude/commands/next.md). The dashboard
prompts are thin — the real rules live in the two skill files.

> **Hard rule (see `AGENTS.md`):** all issues are **opened in Linear**, never GitHub. Work is **closed via
> GitHub PRs** (`Fixes FRA-N`); the Linear–GitHub integration keeps the two in sync. These automations
> never create GitHub issues and never touch code.

---

## Background: the cut-over + the probe result

Per **ADR-16** ([`LINEAR_PM.md`](LINEAR_PM.md)), Linear is the canonical tracker. A capability probe
confirmed that a Cursor **headless background** agent has **no Linear MCP server** and gets no Linear access
for free — so these automations authenticate with a **`LINEAR_API_KEY`** (added to Cursor's cloud-agent
secrets) and talk to Linear's **GraphQL API** directly. (If a future Cursor build exposes a Linear MCP to
background agents, the skills are transport-agnostic and can use it instead — what matters is the
write lands in Linear.)

---

## Linear API access (shared by both automations)

**Auth.** Personal API keys go in the `Authorization` header **with no `Bearer` prefix** (OAuth tokens take
`Bearer`; personal keys do not). Verify at the start of every run:

```bash
export LINEAR_KEY="${LINEAR_API_KEY:?missing LINEAR_API_KEY secret}"
lin() { curl -sS https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_KEY" -H "Content-Type: application/json" \
  --data @-; }
echo '{"query":"{ viewer { id name } }"}' | lin   # must print a real user, not an error
```

**ID cache (team Frapp Live — verify with the queries below if anything 404s).**

- **Team:** `314e108b-1046-47b3-86de-03f652b75cd3`
- **Workflow states:** Triage `a2850363-b7df-4b73-bb9e-d604d84952cd` · Backlog `050d7e98-8ea1-48a2-97d9-5bd64dc6b8b5` · Todo `6429dc31-4dfc-46de-a6b7-df15541e64b2` · In Progress `e511d65d-a745-4bb3-908c-b63ae593daf6` · Done `5b7a5d31-a5b4-4c49-842c-703da7ea6b79` · Canceled `9d624417-4aea-4de7-b42a-841952247f53` · Duplicate `fd6c1d6d-c32c-403f-a079-5d450547153f`
- **Labels:** `suggestion` `8a66aaf4-4ce1-4d60-85f4-124ae9a3d797` · `stale` `870f55fc-bb9e-4f71-8c63-506a75d00992` · `area:api` `b017cbf3-26cb-4433-88a0-9df9a13293c3` · `area:web` `361c705a-e706-45c4-8b8f-be45f0d11bc9` · `area:db` `2e4dad0b-54ff-4c1a-96d8-b0cc98e45f4b` · `area:deps` `85425714-0935-42c3-8439-2aa8c4e649e4` · `area:security` `ef7dabf6-0525-4b4b-b746-206626e2baf8` · `area:ci` `faa1a134-cac7-42dd-af29-fa37231622c4` · `area:docs` `e9a453c0-b22d-4b8b-b030-9fe9521dd145` · `area:product` `774ebfda-efeb-4d0d-b642-c674c723abcd` · `area:ux` `181da3c2-75a4-400b-9c66-cf80921b4f7e` · `area:research` `5b970893-cecc-4a7d-9cf7-c2990d05db1c`
- **Projects:** Chat rework `f791b8ee-ba4f-4e93-8543-c8eec06ab43e` · AI features `aab3d43d-480c-4727-9bf7-c9f8d6feafba` · Pricing & billing `bbcfce89-54ff-4b56-b791-2c34c463f459` · Analytics `e0978d9a-8376-4a92-ade7-0fd4e5216b12` · Platform `54493732-d789-4dbb-a161-90190ef951ec` · Security `1726c786-ef16-474c-91cf-b397e2b726d6`

Fetch fresh IDs if needed: `{ teams { nodes { id key name states { nodes { id name type } } labels { nodes { id name } } projects { nodes { id name } } } } }`.

**Common operations** (priority: 1 Urgent · 2 High · 3 Medium · 4 Low; `issueUpdate`/`commentCreate` take the
issue **UUID** `id`, not the `FRA-N` identifier):

```graphql
# List the open suggestion set (grep descriptions client-side for fp= to dedup)
{ issues(filter: { team:{id:{eq:"<team>"}}, labels:{name:{eq:"suggestion"}},
                   state:{type:{nin:["completed","canceled"]}} }, first: 250)
  { nodes { id identifier title priority state{name} project{name} labels{nodes{name}} description } } }

# Create a suggestion in Triage with a priority + area label
mutation { issueCreate(input:{ teamId:"<team>", title:"[suggestion] …", description:"…\n<!-- cursor-suggestion: v1 fp=area/slug file=path -->",
  stateId:"<Triage>", priority:2, labelIds:["<suggestion>","<area>"] }) { success issue{ identifier url } } }

# Resolve / cancel / re-label / re-body  (read labels first — pre-write ownership gate)
mutation { issueUpdate(id:"<uuid>", input:{ stateId:"<Done|Canceled>" }) { success } }
mutation { commentCreate(input:{ issueId:"<uuid>", body:"Resolved: implemented in `path` (FRA-/PR …)." }) { success } }

# Duplicate relation; sub-issue (set parentId); blocked-by relation
mutation { issueRelationCreate(input:{ issueId:"<dup uuid>", relatedIssueId:"<canonical uuid>", type: duplicate }) { success } }
mutation { issueUpdate(id:"<child uuid>", input:{ parentId:"<parent uuid>" }) { success } }
mutation { issueRelationCreate(input:{ issueId:"<uuid>", relatedIssueId:"<blocker uuid>", type: blocks }) { success } }

# Triage: bucket + prioritize + promote
mutation { issueUpdate(id:"<uuid>", input:{ projectId:"<project>", priority:3, estimate:3, stateId:"<Backlog>" }) { success } }
```

---

## Settings (every option, set in the dashboard — apply to BOTH automations unless noted)

| Setting | Value | Notes |
|---|---|---|
| Repository | `pdcarlson/Frapp` | Source the agent reads. |
| Branch | `main` | Skills/rules are read from `main` at run time. |
| Trigger | **Schedule** | Curator daily (e.g. 08:00 ET, `0 8 * * *`); Triage daily ~1h later (`0 9 * * *`). No PR-merged trigger — daily cadence avoids a new run per close. |
| Model | a high-reasoning model | Quality scales with reasoning; pick the strongest available. |
| Tools / integrations | shell only | The agent calls Linear's GraphQL API with `curl`. Disable code edits / branch pushes. |
| Auto-create PR | **off** (`autoCreatePR:false`) | These flows file/organize issues, never code. |
| Secrets / env | **`LINEAR_API_KEY`** = a Linear **personal API key** (Settings → Security & access → Personal API keys) with issue create/read/write scope | Stored in Cursor's cloud-agent secrets. Used as `Authorization: $LINEAR_API_KEY` (no `Bearer`). **Not** in the repo. |
| Memory | **on** | Lets the agent learn what it already filed. |
| Network access | default | GraphQL calls need outbound HTTPS to `api.linear.app`. |
| Sandbox setup | [`.cursor/environment.json`](../../../.cursor/environment.json) (`npm install`) | Makes lint/typecheck/`npm audit` available for the curator's engineering lens. |

---

## Labels (Linear)

The taxonomy lives in Linear (see [`LINEAR_PM.md`](LINEAR_PM.md#labels-and-priority-lean-taxonomy)).
Automations use: **`suggestion`** (ownership/dedup/lifecycle anchor), one **`area:<x>`**
(`api`/`web`/`db`/`deps`/`security`/`ci`/`docs`/`product`/`ux`/`research`), and **`stale`** (aging,
can't-prove-resolved). **Severity is the native Priority**, not a label. `type:<gap|improvement|idea>` is
description metadata, not a label.

---

## Dashboard agent instructions (copy-paste)

The Cursor UI takes a short prompt per automation. Keep it thin — it just points the agent at its skill
file, which holds the real rules. Paste these verbatim.

**Automation 1 — "Linear Issue Curator"** (schedule: daily):

```text
You are the Linear Issue Curator for the Frapp repository — a meticulous engineer and product thinker
who keeps the Linear backlog healthy and high-signal, not just growing. Each run, follow
.cursor/skills/linear-curator.md EXACTLY: first MAINTAIN the existing `suggestion` issues in Linear
(set Done/Canceled only when code or spec/ PROVES it, else mark `stale`; dedup; refresh drifted bodies;
split oversized), then DISCOVER a few high-value new items and file them into Linear's TRIAGE inbox via
the LINEAR_API_KEY (GraphQL). Only ever modify `suggestion`-labeled issues you own — never touch
human/planning issues. NEVER create a GitHub issue; never edit code or open PRs. Filing zero new issues
is a perfectly good outcome.
```

**Automation 2 — "Linear Triage"** (schedule: daily, ~1h after #1):

```text
You are the Linear Triage agent for the Frapp repository — you keep the board clean so `/next` always
has good work to pull. Follow .cursor/skills/linear-triage.md EXACTLY: process Linear's TRIAGE inbox —
dedup, set a Project and a Priority (required to leave Triage), add blocked-by relations, and promote
clearly-actionable items to BACKLOG; leave ambiguous or human-filed items in Triage with a short comment.
You may organize ANY Triage item (project/priority/estimate), but only cancel or mark-duplicate
`suggestion`-owned issues. Use the LINEAR_API_KEY (GraphQL). NEVER create a GitHub issue; never edit code
or open PRs.
```

---

## How to create them (dashboard)

1. `cursor.com/agents` (or the Automations dashboard) → **New automation** → "Linear Issue Curator".
2. Schedule daily (e.g. 08:00 ET); repo `pdcarlson/Frapp`, branch `main`, high-reasoning model.
3. Paste the **Curator** prompt from [Dashboard agent instructions](#dashboard-agent-instructions-copy-paste) above.
4. Add the **`LINEAR_API_KEY`** secret. Turn on **Memory**, leave PR creation / code edits **off**.
5. Repeat for **"Linear Triage"**, scheduled ~1h later, with the **Triage** prompt from that section.
6. Toggle both **Active**.

> The agents read their skill from `main` at run time. Until this branch merges, point the automations'
> branch at `claude/laughing-keller-I1wUe` or the skills won't be present.

## Verify
- **Curator:** run it. Confirm new issues land in **Linear Triage** titled `[suggestion] …` with
  `suggestion` + `area:*` + a Priority + the hidden `fp=` marker; run it again → **no duplicates**; confirm
  it Done/Cancel/refreshes/`stale`s existing `suggestion` issues and leaves every non-`suggestion` issue
  untouched (ownership gate holds). **No GitHub issue is created.**
- **Triage:** run it. Confirm Triage items get a Project + Priority and clearly-actionable ones move to
  Backlog; human-filed/ambiguous items stay in Triage with a comment; nothing human-owned is canceled.
- Confirm both schedules show a next-run time.

## Maintenance
- Behavior changes go in the two `.cursor/skills/linear-*.md` files; only re-paste a dashboard prompt if the
  prompt block itself changes.
- Keep the ID cache above current if states/labels/projects change.
- Environment notes: [`spec/environments/README.md`](../../../spec/environments/README.md#cursor-automations-environment).
