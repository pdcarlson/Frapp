---
name: coordinator
description: >
  Run a standing coordinator chat that takes Paul's or Shawn's feedback and ideas, refines and
  classifies them, and spins the real work off into worker sessions that report back, keeping a
  shared board page current and handing itself off at 50% context. Use when a session is started
  as a coordinator (for example "Beta Launch"), or when asked to coordinate feedback into parallel
  threads the way a Claude Code project's coordinator does.
---

# Coordinator

> **Since 2026-11-09:** Shawn and Winston work in their own Claude chats under their own GitHub
> accounts ([`AGENTS.md` § Operating mindset](../../../AGENTS.md#operating-mindset)), not through
> this board. The Shawn intake and approval rules below apply only to anything he still brings here.

Claude Code projects, a coordinator chat that spins off threads, aren't offered on Team plans
(checked 2026-11-08, [docs](https://code.claude.com/docs/en/claude-projects)). This skill builds the
same shape from parts this environment has. Checked on 2026-11-08: `create_session` starts a worker,
a worker's `send_message` to the coordinator is delivered (it arrives as a new turn once the
coordinator's current turn ends), and `get_session` reads context use. The front door both people
share is an artifact page, whose comments sent to Claude wake the session that published it (the
Artifact tool's stated behavior, not yet tried from Shawn's account). A shared session is view-only for
teammates ([docs](https://code.claude.com/docs/en/claude-code-on-the-web), "Share sessions"), so
Shawn reaches the coordinator through the page, not the chat.

## The job

Take whatever Paul or Shawn brings, here or through the board: bugs from using the app, UI notes,
ideas, questions. Do little of the work yourself. Your job is to understand it, route it, and keep
track.

- **Refine, don't correct.** Restate what you understood in a line, ask only what routing needs, and
  sharpen it with what the code and the tracker say. Shawn is the product person: plain words, no
  code, no file paths.
- **Classify and size.** Bug, UI change, feature idea, question, or ops. Decide whether it can be
  done now, how, and how big. Say whether it serves the beta ([#2558](https://github.com/pdcarlson/Frapp/issues/2558)).
- **Route.** Answer a question a few lookups settle, here. Anything that needs research, design or
  code goes to a worker, one per independent piece, and several at once is normal. Point a duplicate
  at its open issue or PR.
- **Pace.** Frapp ships fast and has no users yet. Workers build and open PRs, and nothing waits on
  testers trying an earlier step. Paul merges.
- **Who approves.** Paul's items go straight to building. Shawn's ideas go to a research-and-design
  worker first (scope, options, and a before/after page per
  [`ui-development` § Proposing a UI change](../ui-development/SKILL.md#proposing-a-ui-change)), and
  are built once Paul says go, here or on the board.

## Workers

Start each one with `create_session`: `source_url` `https://github.com/pdcarlson/Frapp`, a title
naming the work, tags `frapp:coordinator`, and a brief that stands alone. The brief carries:

- the goal and what done looks like;
- what you already know: the asker's words, issues, PRs, files, the board row;
- the constraints: AGENTS.md applies, UI work follows `ui-development`, ship fast;
- this report-back contract, verbatim: "Report to the coordinator with `send_message` to session
  `<coordinator session id>` at these points only: your plan in two lines when you start; a decision
  you need (ask it in your own chat too, so Paul or Shawn can answer there); each PR you open; and
  done or blocked, in one paragraph. If the coordinator moves, it messages you its new id."

Add the board row as soon as the worker starts. A report arrives here as a new turn: update the
row, tell the asker in a line, and act on it. Archive a worker's session (`archive_session`) once
its PR merged or its work is reported done.

## The board

The board is an artifact page built from [`hub.html`](hub.html): a live list of the work, and an
**Add an idea** button that opens the comment box, where **Send to Claude** wakes this session.

- **First start.** Publish `hub.html` with `capabilities: {db: {rules: [{path: "threads", read:
  "view", write: "owner"}]}, comments: {composer_only: true}, user: {}}` and the board's name as its
  title. Pass `pin: true` when Paul asked for it pinned. Publishing from this session subscribes it to
  comments sent to Claude. Then tell Paul to share the page with the organization and to give Shawn
  edit access, since Send to Claude is offered only to people who can edit the page.
- **Rows.** One document per piece of work in the `threads` collection: `title`, `asker`, `kind`,
  `status`, `waiting_on`, `summary`, `session_url`, `links` (a list of `{label, url}`), and
  `updated_at` (ISO). `status` is one of `researching`, `designing`, `building`, `in review`,
  `waiting`, `parked`, `done`. Write rows with `ArtifactData` (`batch` for several). Shawn reads
  them, so write them plainly.
- **Comments.** A comment sent to Claude arrives as a new turn. Read it with `ArtifactComments`,
  answer in its thread briefly and plainly, then route it like anything said here.
- **Ledger.** The board holds everything a successor needs. Park work that won't happen now as a
  `parked` row with its reason. Each row links its GitHub issue, filed per `file-follow-up`: the
  issues are the record ([`AGENTS.md` § Work tracking](../../../AGENTS.md#work-tracking)).

## Context: hand off at 50%

The session can't run `/compact` on itself, so it hands off instead. After each turn's work, call
`get_session` with no session id and read `external_metadata.context_usage` (`used_tokens` of
`max_tokens`; it trails by one turn). At 50% or more:

1. Bring the board up to date.
2. Write the handoff per [`handoff`](../handoff/SKILL.md): the board's URL, each open worker's
   session id and state, the decisions and preferences heard so far, and what you were about to do.
3. Start the successor with `create_session`: the same title plus a number, `source_url` the repo,
   and a first message that says to run this skill as the successor of this session, followed by
   the handoff.
4. The successor watches the board's comments with `ArtifactComments`. It doesn't republish.
5. Send each open worker the successor's session id with `send_message`.
6. Tell Paul here, with the successor's link, and take no new work in this chat.

## Limits

- **Budget.** Each worker carries about 90,000 tokens of fixed setup before it does anything
  (measured 2026-11-08). Don't start one for what a lookup answers. Usage credits are off for the
  organization, so heavy use pauses at the seat limit rather than billing.
- **Identity.** Workers run on the coordinator owner's account, GitHub and environment, so anything
  Shawn sends runs as Paul. That is why Shawn's ideas stop at research and design until Paul approves.
- **Hands off.** Never merge or turn on auto-merge, and never change production without Paul.
