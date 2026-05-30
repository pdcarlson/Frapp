# Chat-first redesign — process conventions

> **Spec content has moved.** Per-chunk briefs now live under [`spec/behavior/<topic>/chunks/`](../../../spec/behavior/) and [`spec/architecture-chunks/`](../../../spec/architecture-chunks/). The architectural narrative (product positioning, hot-path architecture, theming model, engineering principles — was `master-plan.md`) is at [`spec/redesign-context.md`](../../../spec/redesign-context.md). The STATUS doc has been retired; **chunk status is tracked in the in-repo project board at [`../board/chat-redesign.md`](../board/chat-redesign.md)** (the source of truth — run `/status`). The redesign is one project on that board; see [`../board/README.md`](../board/README.md) for the whole-product view.

This README only documents the **process** for working a chunk. The content of each chunk lives at its co-located spec path (linked from the spec roadmap).

## Read order for a fresh session

1. **[`../board/chat-redesign.md`](../board/chat-redesign.md)** — start here. The project board is the source of truth for chunk status, issues, and progress. [`spec/README.md`](../../../spec/README.md)'s Roadmap section indexes the chunk briefs. Run `/status` for a live dashboard.
2. **The specific chunk brief you've been assigned.** Each brief is self-contained: read these files, build this, verify like this, commit & push to this branch.
3. **`AGENTS.md`** at the repo root and the linked playbooks (`.cursor/skills/`). Standard operating context — branch model, doc-sync mandate, secrets policy, and the GitHub-issues workflow.
   - Before opening your chunk PR, self-review against **[`REVIEW_CHECKLIST.md`](REVIEW_CHECKLIST.md)** (peer to this file). The same checklist is used by whoever reviews the PR.
4. Files explicitly listed under the chunk's "Read first" section.

Do **not** start coding from a vague "redesign Frapp" prompt. Always work a specific chunk. If you don't know which chunk to start, work the lowest-numbered chunk whose dependencies are complete.

## Reusable session commands

Two Claude Code project slash commands (under [`.claude/commands/`](../../../.claude/commands/)) encode this workflow so it doesn't have to be pasted each session:

- **`/next-task [#]`** — the single work command. Given an issue number it targets that issue; with no number it scans the backlog, shortlists viable/easy/important issues, and lets you pick. It verifies, fixes, tidies the backlog, and opens a draft PR. (Replaces the old `/next-task` + `/tackle-issue` pair, which had nearly identical flows.)
- **`/status`** — read-only progress dashboard: cross-checks the roadmap status table against open issues per chunk and prints how close we are to launch.

`/next-task` begins in plan mode, fans out to sub-agents for research, runs `/code-review` before opening a draft PR, and closes issues via `Closes #N` (solo project — no *In Review* stage).

## Operating conventions for chunk sessions

- **Branch per chunk.** Create `claude/redesign-chunk-NN-<slug>` from `main`. Never push directly to `main` or `production`.
- **Step 0: reconcile open issues.** Before you start, glance at open issues for anything already shipped that should be closed. **This is a solo project — there is no "In Review" stage.** When work lands, the issue gets **closed**, not held open. So: when you open a PR, put `Closes #N` in the body and let the merge close the issue; if you finish and merge in-session, confirm the issue closed.
- **Read the spec docs the chunk lists before writing code.** Each chunk lists specific `spec/*.md` and `docs/*` files that constrain its work.
- **Update spec docs in the same PR.** Frapp's doc-sync mandate requires every non-doc PR to update at least one file under `docs/` or `spec/`. The chunk briefs list which specs each chunk should touch.
- **Verification is non-negotiable.** Each chunk has a verification checklist. Don't open a PR with the checklist incomplete; surface what didn't work in the PR body instead of pretending it did.
- **Visual-baseline discipline.** If a chunk changes shared CSS/tokens and shifts Playwright visual baselines, regenerate only the baselines that actually changed and list each one (with the reason) in the PR body. Don't blanket-regenerate all baselines — it hides real regressions in the noise. If a global change legitimately touches many baselines (e.g. a palette swap), say so explicitly and call out which surfaces a reviewer should eyeball. Note the Chromium revision you regenerated against vs. the one CI pins.
- **Reference the chunk in your PR body.** `Implements <co-located chunk path>.` That keeps the trail back to the spec.
- **If you make a scope decision that diverges from the chunk brief, edit the brief in the same PR.** The spec is the source of truth, not your in-flight assumptions.

## Project board

**Solo project, so the board is not part of the workflow — the issue's open/closed state _is_ the status.** Don't move Projects v2 cards or chase an "In Review" column; just close the issue when the work merges (`Closes #N` in the PR body does this automatically). Skipping the board is the expected default, not a shortcut.

The rest of this section is kept only as reference for the rare case someone explicitly asks to update a board. The board is a GitHub **Projects v2** board: **GraphQL-only**, no REST and no `mcp__github__*` tool. It needs `GITHUB_PAT` with **Projects → Read and write** (see [`AGENT_INFRA.md` § GitHub PAT usage policy](../AGENT_INFRA.md#github-pat-usage-policy) for the permission and the `FORBIDDEN` failure signature). Three calls — find the project's status field + the item for your issue, then set the value:

```bash
GQL() { curl -s https://api.github.com/graphql -H "Authorization: bearer $GITHUB_PAT" \
  -H "Content-Type: application/json" -d "{\"query\":\"$1\"}"; }

# 1. Project id + the Status field's id and option ids (find the "In Review" / "Shipped" id)
GQL 'query{ user(login:\"pdcarlson\"){ projectV2(number:N){ id field(name:\"Status\"){ ... on ProjectV2SingleSelectField { id options{ id name } } } } } }'

# 2. The project item id for your issue (add it first with addProjectV2ItemById if projectItems is empty)
GQL 'query{ repository(owner:\"pdcarlson\",name:\"frapp\"){ issue(number:484){ projectItems(first:10){ nodes{ id project{ id } } } } } }'

# 3. Set the status
GQL 'mutation{ updateProjectV2ItemFieldValue(input:{ projectId:\"PROJECT_ID\", itemId:\"ITEM_ID\", fieldId:\"STATUS_FIELD_ID\", value:{ singleSelectOptionId:\"OPTION_ID\" } }){ projectV2Item{ id } } }'
```

If the PAT lacks the Projects permission this fails with `FORBIDDEN: Resource not accessible by personal access token` — report it and ask for the permission rather than claiming the move is impossible.

## When the chunk is wrong

The chunk briefs are forecasts, not contracts. If a chunk's assumptions don't survive contact with the code, push back: edit the chunk brief in place, leave a note on the chunk's GitHub issue, and pick up from the corrected plan. Future sessions will read what you left, not what was originally written.
