# Chat Integrations — Slash Commands, Renderers, and System Channel

Chat is the spine; every ops module is a **chat integration** (see [README.md](./README.md) → *Chat is the spine*). This file specifies the slash-command catalog, the dispatch path, the rich-message renderer registry, and the `#chapter-audit` system-channel bridge. Push-notification rules for chat live in [../notifications.md](../notifications.md).

## Slash command catalog

Slash commands turn chat into the dispatcher for every ops module. The catalog is filtered by the chapter's `enabled_modules` so disabling a paid module hides its command from the palette without UI churn. Commands marked `implemented: true` post a rich message; `implemented: false` commands surface a "coming soon" toast as modules ship. **Server-side authorization is independent of the client gate** — the Edge Function re-checks permission for every send; the client gate is UX only, the server is the trust boundary.

| Command | Implemented | Required module | Server gate | Posted to |
| --- | --- | --- | --- | --- |
| `/poll "Q?" Opt1 Opt2 [closes=<mins>]` | yes | `polls` | chapter member | current channel |
| `/announce <message>` | yes | always-on | `announcements:post` (or `*`) via `canAccessChannel({ operation:'post' })` | `#announcements` |
| `/event`, `/task`, `/dues`, `/points`, `/hours` | no | per-module | n/a | n/a (palette stub) |

Parsing rules live in `packages/chat-integrations/src/parsers.ts` (`parsePollArgs`, `parseAnnounceArgs`) so web, mobile, and any future heavy-command RPC share one source of truth. Poll arguments tokenize on whitespace but respect double-quoted spans for the question; unterminated quotes return a specific error rather than silently truncating. Polls require at least two distinct options (case-insensitive dedup) and at most ten; an optional trailing `closes=<minutes>` overrides the 24-hour default.

## Slash command dispatch

- **Simple commands** (`/poll`, `/announce`) parse on the client and post via the `chat-send` Edge Function with the appropriate `kind` (`poll` | `announcement`) and parsed args in `payload`. One round-trip.
- **Heavy commands** (e.g. `/dues remind overdue`) render a `kind="loading"` placeholder card optimistically, then call a NestJS RPC; the server replaces the card in place via Realtime by updating the row's `kind` + `payload`. The renderer registry handles this row mutation gracefully.
- A plain text message (no leading slash) goes through `chat-send` as `kind="text"`.

## Announcement gating

`/announce` is exec-only and posts to the current chapter's `#announcements`. The gate is the `operation: 'read' | 'post'` parameter on the shared `canAccessChannel` predicate (default `'read'`): for `operation:'post'`, after the read check passes, the predicate denies when the channel `is_read_only` and the caller holds neither `announcements:post` nor `*`. Enforced server-side in both `chat-send` and the NestJS cold-path `chat.service.sendMessage`. The client hides the disallowed command for UX, but the server is the trust boundary.

## Vote-change (UPSERT semantics)

Poll votes are written to `chat_message_actions` via the `chat-react` Edge Function. Every user has **at most one** row with `action_type='vote'` per poll message (the dedupe unique index `(message_id, user_id, action_type)` is retained). Switching options is an UPSERT: on conflict the function updates `payload.option_id` (and `created_at`) in place and returns a distinct response shape (`updated: true`) so the optimistic client can replay the tally. Emoji reactions (`action_type='reaction:<emoji>'`) keep the unique-violation → dedup path unchanged (one reaction per user per emoji, toggle to remove).

## Rich-message renderer registry

The `packages/chat-integrations/` registry maps a message `kind` → a React component, shared by web (Tailwind) and mobile (NativeWind) so the registry is never forked. Concrete renderers exist for `text` (default), `poll`, `announcement`, `system_audit`, and `loading` (placeholder while a heavy command computes). The remaining ops kinds (`event`, `task`, `dues`, `points`, `hours`) have stub renderers that show a "renderer coming soon" card, so modules can drop in concrete renderers without UI-plumbing work. Card action buttons (Vote, RSVP, Pay, Confirm, Submit) fire through the chat hot path — optimistic and idempotent.

See [README.md](./README.md) → *Message Kinds and Actions* for the canonical `kind` table.

## `#chapter-audit` system-channel bridge

Member-visible officer changes (dues, modules, roles) surface in chat as a system-written audit feed. The bridge worker subscribes (service-role) to `chapter_audit_log` INSERT via Supabase Realtime and posts a `kind='system_audit'` message into the chapter's `#chapter-audit` channel as the system sender (`00000000-0000-0000-0000-000000000000`). This is a server-originated insert that bypasses the Edge Function and goes direct via service role; it has a single owner (no inline audit-post in writing services).

- Rows with `member_visible=false` are skipped — internal-scope rows stay out of the channel.
- Message shape: `sender_id` = system sender; `content` = human summary (`"<action>: <diff keys>"`); `kind` = `system_audit`; `payload` = `{ action, actor_user_id, diff }`. The renderer reads from `payload`, not the prose `content`.
- Chapters that pre-date the `#chapter-audit` channel have no mirror; the bridge logs and continues. The audit row itself is always the source of truth.

The same `system_audit` message pattern is reused, targeted to a DM, for the invite-accept notification (see [README.md](./README.md) → *Direct Messages*).
