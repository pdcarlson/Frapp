# Chat Integrations — Slash Commands, Renderers, and System Channel

Chat is the spine; every ops module is a **chat integration** (see [README.md](./README.md) → *Chat is the spine*). This file specifies the slash-command catalog, the dispatch path, the rich-message renderer registry, and the `#chapter-audit` system-channel bridge. Push-notification rules for chat live in [../notifications.md](../notifications.md).

## Slash command catalog

Slash commands turn chat into the dispatcher for every ops module. The catalog is filtered by the chapter's `enabled_modules` so disabling a paid module hides its command from the palette without UI churn. Commands marked `implemented: true` post a rich message; `implemented: false` commands surface a "coming soon" toast as modules ship. **Server-side authorization is independent of the client gate** — the Edge Function re-checks permission for every send; the client gate is UX only, the server is the trust boundary.

| Command | Implemented | Required module | Server gate | Posted to |
| --- | --- | --- | --- | --- |
| `/poll "Q?" Opt1 Opt2 [closes=<mins>]` | yes | `polls` | chapter member | current channel |
| `/announce <message>` | yes | always-on | `announcements:post` (or `*`) via `canAccessChannel({ operation:'post' })` | `#announcements` |
| `/points grant\|deduct @member <amount> for <reason>` | yes | `points` | `points:adjust`, re-checked on `POST /v1/points/adjust` (no self-adjust, 50/hr rate limit) | current channel |
| `/task "<title>" @assignee <YYYY-MM-DD> [points]` | yes | `tasks` | `tasks:manage`, re-checked on `POST /v1/tasks` (assignee must be a chapter member) | current channel |
| `/event`, `/dues`, `/hours` | no | per-module | n/a | n/a (palette stub) |

Parsing rules live in `packages/chat-integrations/src/parsers.ts` (`parsePollArgs`, `parseAnnounceArgs`, `parsePointsArgs`, `parseTaskArgs`) so web, mobile, and any future heavy-command RPC share one source of truth. Poll arguments tokenize on whitespace but respect double-quoted spans for the question; unterminated quotes return a specific error rather than silently truncating. Polls require at least two distinct options (case-insensitive dedup) and at most ten; an optional trailing `closes=<minutes>` overrides the 24-hour default. `/points` parses `grant`/`deduct`, an `@member` token (resolved to a user id at dispatch from the chapter directory), a positive whole amount, and the reason after the literal `for`; `grant` maps to a `+amount` `MANUAL` adjustment and `deduct` to a `−amount` `FINE`. `/task` parses a double-quoted title (titles routinely contain spaces), an `@assignee` token (resolved to a user id at dispatch), a required `YYYY-MM-DD` due date (validated as a real calendar date), and an optional trailing non-negative whole-number point reward.

## Slash command dispatch

- **Simple commands** (`/poll`, `/announce`) parse on the client and post via the `chat-send` Edge Function with the appropriate `kind` (`poll` | `announcement`) and parsed args in `payload`. One round-trip.
- **Heavy commands** (e.g. `/points grant`, `/task`, `/dues remind overdue`) render a `kind="loading"` placeholder card optimistically (cache-only, with a `client_message_id`), then call a NestJS RPC; the server performs the side effect and posts the rich card itself carrying the **same `client_message_id`**, so the Realtime echo reconciles the placeholder in place via `mergeServerRow`. `/points` calls `POST /v1/points/adjust` with the active `channel_id` + `client_message_id`; on a committed ledger row the service posts the `kind="points"` card. `/task` calls `POST /v1/tasks` the same way; on a committed task row `TaskService.create` posts the `kind="task"` card (see *Server-originated kinds* below). The committed row is the source of truth — a failed card post is logged, never rolled back; the client drops the placeholder on an HTTP error.
- A plain text message (no leading slash) goes through `chat-send` as `kind="text"`.

## Server-originated kinds (anti-forgery)

A `points`, `task`, or `system_audit` card asserts that a server-side side effect happened (a committed ledger row, a created task, an audit entry). A client therefore **cannot** post these kinds directly: `chat.service.sendMessage` rejects any send whose `kind` is in `SERVER_ONLY_KINDS` (`points`, `task`, `system_audit`) unless the trusted internal caller sets `system_originated: true` (never exposed on `SendMessageDto`). `PointsService.adjustPoints` is the only writer of `points` cards; `TaskService.create` is the only writer of `task` cards; the `#chapter-audit` bridge worker is the only writer of `system_audit`. The optimistic `loading` placeholder stays client-postable — it carries no assertion until the server's real card replaces it.

## Announcement gating

`/announce` is exec-only and posts to the current chapter's `#announcements`. The gate is the `operation: 'read' | 'post'` parameter on the shared `canAccessChannel` predicate (default `'read'`): for `operation:'post'`, after the read check passes, the predicate denies when the channel `is_read_only` and the caller holds neither `announcements:post` nor `*`. Enforced server-side in both `chat-send` and the NestJS cold-path `chat.service.sendMessage`. The client hides the disallowed command for UX, but the server is the trust boundary.

## Vote-change (UPSERT semantics)

Poll votes are written to `chat_message_actions` via the `chat-react` Edge Function. Every user has **at most one** row with `action_type='vote'` per poll message (the dedupe unique index `(message_id, user_id, action_type)` is retained). Switching options is an UPSERT: on conflict the function updates `payload.option_id` (and `created_at`) in place and returns a distinct response shape (`updated: true`) so the optimistic client can replay the tally. Emoji reactions (`action_type='reaction:<emoji>'`) keep the unique-violation → dedup path unchanged (one reaction per user per emoji, toggle to remove).

## Rich-message renderer registry

The `packages/chat-integrations/` registry maps a message `kind` → a React component, shared by web (Tailwind) and mobile (NativeWind) so the registry is never forked. Concrete renderers exist for `text` (default), `poll`, `announcement`, `system_audit`, `loading` (placeholder while a heavy command computes), `points` (read-only ledger card: `actor → recipient`, signed amount, reason — append-only, no actions), and `task` (interactive assignment card). The `task` card is an immutable creation-time snapshot (`assigner → assignee`, title, due date, point reward) whose **live** status is read back through the task query — the chat message row is never mutated — and carries inline lifecycle actions: the assignee can Start / Mark complete and a `tasks:manage` admin can Confirm / Reject, gated client-side for UX with the existing task REST endpoints as the trust boundary. The remaining ops kinds (`event`, `dues`, `hours`) have stub renderers that show a "renderer coming soon" card, so modules can drop in concrete renderers without UI-plumbing work. Card action buttons (Vote, RSVP, Pay, Confirm, Submit) fire through the chat hot path — optimistic and idempotent.

See [README.md](./README.md) → *Message Kinds and Actions* for the canonical `kind` table.

## `#chapter-audit` system-channel bridge

Member-visible officer changes (dues, modules, roles) surface in chat as a system-written audit feed. The bridge worker subscribes (service-role) to `chapter_audit_log` INSERT via Supabase Realtime and posts a `kind='system_audit'` message into the chapter's `#chapter-audit` channel as the system sender (`00000000-0000-0000-0000-000000000000`). This is a server-originated insert that bypasses the Edge Function and goes direct via service role; it has a single owner (no inline audit-post in writing services).

- Rows with `member_visible=false` are skipped — internal-scope rows stay out of the channel.
- Message shape: `sender_id` = system sender; `content` = human summary (`"<action>: <diff keys>"`); `kind` = `system_audit`; `payload` = `{ action, actor_user_id, diff }`. The renderer reads from `payload`, not the prose `content`.
- Chapters that pre-date the `#chapter-audit` channel have no mirror; the bridge logs and continues. The audit row itself is always the source of truth.

The same `system_audit` message pattern is reused, targeted to a DM, for the invite-accept notification (see [README.md](./README.md) → *Direct Messages*).
