# Chunk 05 — Chat part 2: rich messages + slash commands + system channel + push

**Depends on:** Chunk 04 (chat foundation + hot-path client + slash palette scaffold).
**Unblocks:** all Chunk 10 sub-chunks, Chunk 11 (mobile parity needs the renderers).

## Kickoff decisions (locked before implementation)

These were locked at the start of the implementation session and are
non-negotiable mid-chunk. If implementation reveals one is wrong, add a
"Revised:" note immediately under the affected lock in the same PR,
update the linked ADR, and call it out in the PR body.

1. **`chat_notification_preferences` is a NEW table, not a column added
   to `notification_preferences`.** Shape:
   `(id, user_id, chapter_id, scope text check (scope in ('channel','kind')),
   scope_id uuid|null, scope_kind text|null, level text check (level in
   ('all','mentions','off')), updated_at)`. The existing
   `notification_preferences` table is boolean-only (`is_enabled`) and
   category-keyed; squatting on `category` to encode `channel:<uuid>`
   loses type safety and makes the migration path painful. A future
   unification PR can consolidate when chat is the last preference
   producer. (→ ADR-06)

2. **`chat-react` switches to UPSERT for vote-change.** Keep the
   `idx_chat_message_actions_dedupe` unique index on
   `(message_id, user_id, action_type)`. Poll votes share
   `action_type='vote'`; the option id lives in `payload.option_id`.
   On conflict the function UPDATEs `payload` + `created_at` and
   returns a distinct response shape (`updated:true`) so the optimistic
   client can replay the tally. Emoji reactions
   (`action_type='reaction:<emoji>'`) keep the 23505 → select-existing
   dedup path unchanged. (→ ADR-07)

3. **Audit→chat bridge lives in a NestJS Realtime subscriber, not a
   PG trigger and not inline in writing services.** A new
   `ChatBridgeWorker` subscribes (service-role) to `postgres_changes`
   on `chapter_audit_log` INSERT and posts a `kind='system_audit'`
   message into the chapter's `#chapter-audit` channel. The inline
   `postAuditMessage` in `chapter-config.service.ts` is removed in the
   same PR so the bridge has a single owner. (→ ADR-08)

4. **Push worker host = in-process API module
   (`OnApplicationBootstrap`), not a standalone service.** Same NestJS
   process; one Supabase Realtime subscription to `chat_messages`
   INSERT; per-recipient fanout reuses
   `NotificationService.notifyUser`. Scaling watermark that triggers
   a standalone split: sustained `p99 fanout latency > 1s` OR
   `worker-loop CPU > 40%`. Linked from `docs/DEPLOYMENT.md`.
   (→ ADR-09)

5. **Presence source = Supabase Realtime Presence on the
   `chat:channel:<id>` topic.** Web client calls
   `channel.track({userId, ts})` from the `SUBSCRIBED` callback in
   `realtime-manager.ts`; the push worker opens a service-role
   subscription per active channel and reads `presenceState()` before
   fanout. A custom broadcast topic is rejected — it re-implements
   what Presence already gives us and creates a second source of
   truth. (→ ADR-10)

6. **PR shape: one PR, three reviewable sections, in this order.** (A)
   schema + announcements gate; (B) dispatch + renderers; (C) push
   worker + audit bridge. Reassess at ~40 files; if exceeded, split
   (C) into a follow-up PR that blocks nothing UI-side.

7. **`announcements:post` gate = extend `canAccessChannel` with an
   `operation: 'read' | 'post'` parameter (default `'read'`).** Adds a
   single optional clause to the existing predicate rather than a
   parallel `canPostToChannel` sister. `ChannelAccessRecord` gains
   `is_read_only: boolean`. For `operation:'post'`, after the existing
   read check, deny when `channel.is_read_only` and the caller holds
   neither `'announcements:post'` nor `'*'`. Server-side enforcement
   in `chat-send` and the NestJS cold-path `chat.service.sendMessage`;
   the client hides the disallowed command for UX, but the server is
   the trust boundary.

## Read first

1. `spec/redesign-context.md` — *Architecture: Chat as the spine* (modules-as-integrations pattern), *Push notification rules*, *Slash command dispatch path*.
2. `packages/chat-integrations/` (scaffolded in Chunk 04) — registry contract.
3. `apps/web/lib/chat/chat-client.ts` (from Chunk 04) — action button hooks fire through here.
4. Existing push notification code (if any): grep `expo-push` or `notifications` in `apps/api`. Build on it; don't fork.
5. `chapter_audit_log` schema from Chunk 02.

## Branch

`claude/redesign-chunk-05-chat-integrations` — from `main`.

## Goal

Establish the "ops modules are chat integrations" pattern by shipping two end-to-end integrations (`/poll`, `/announce`), the `#chapter-audit` system message bridge, and the presence-aware push notification worker. After this chunk, Chunk 10 can follow the same template per module.

## Tasks

### Rich message renderer registry

1. `packages/chat-integrations/` — registry mapping message `kind` → React component. Components for: `text` (default), `poll`, `announcement`, `system_audit`, `loading` (placeholder while a heavy command computes). Stubs for `event`, `task`, `dues`, `points`, `hours` returning a "renderer coming soon" card so Chunk 10 sub-chunks can drop in concrete renderers without UI plumbing work.
2. Action buttons (Vote, RSVP, Pay…) fire through `chat-client.ts` hot path — optimistic + idempotent.

### Slash command dispatch

3. **Simple commands** (`/poll`, `/announce`) → Edge Function `chat-send` with `kind="poll" | "announcement"` and parsed args in `payload`. One round-trip.
4. **Heavy commands** scaffolding (`/dues remind overdue` — actual implementation in Chunk 10d): client renders a `kind="loading"` placeholder card optimistically, calls NestJS RPC, server replaces card via Realtime by updating the row's `kind` + `payload`. Make sure the renderer registry handles the row mutation gracefully.
5. Slash commands are filtered by `enabled_modules` (already wired in Chunk 04 — just ensure new commands respect it).

### Integration #1: `/poll`

6. `/poll "Question" Option1 Option2 ...` parses on the client, posts via `chat-send` with `kind="poll"`.
7. Poll renderer: question + radio options + "Vote" button. After vote, shows tally bar per option. Closes manually or after 24h (configurable in `payload`).
8. Vote action writes to `chat_message_actions` via `chat-react` Edge Function (idempotent — one vote per user, vote-change allowed).

### Integration #2: `/announce`

9. Exec-only (check role server-side in the Edge Function). Posts to `#announcements` for the current chapter.
10. Triggers push fanout via the new push worker (below).

### `#chapter-audit` system channel bridge

11. NestJS trigger on `chapter_audit_log` insert → service-role insert of a `kind="system_audit"` message into the chapter's `#chapter-audit` channel. This is one of the few server-originated message inserts; it bypasses the Edge Function and goes direct via service role.
12. Renderer: small mono-style card with actor + action + diff summary.

### Push notification worker (NestJS)

13. Subscribe to new `chat_messages` inserts via Realtime in a NestJS worker.
14. Apply presence-aware rules from master plan:
    - Skip recipients online in the affected channel right now (read presence from Supabase or maintain an in-memory map fed by Broadcast).
    - Skip `#chapter-audit` unless user explicitly subscribed.
    - Bundle bursts: 3+ messages from one sender within 60s → 1 push titled "N new messages from X".
    - Respect per-channel notification preferences (new `notification_preferences` table — `(user_id, channel_id_or_kind, level)`, level ∈ `all|mentions|off`).
15. Default preferences seeded by channel kind on channel creation: `#announcements` → `all`; `#general` → `mentions`; system → `off`.

### Spec updates

16. `spec/behavior/chat/README.md` + `spec/behavior/notifications.md` — slash command catalog (initial: `/poll`, `/announce`), notification preferences defaults, audit-log → `#chapter-audit` bridge rules.
17. `spec/ui-web-dashboard.md` — poll card, announcement card, system_audit card visuals.
18. `spec/architecture.md` — push worker placement (which service, scaling considerations).

## Verification

- [ ] In `#general`, run `/poll "What night for chapter?" Monday Tuesday Wednesday`. Two browsers see the card in real time. Vote in each. Live tally updates without page reload.
- [ ] Exec runs `/announce "Big meeting tomorrow"` — card appears in `#announcements`, a logged-out tester device receives a push, sender does NOT receive a push to their own message.
- [ ] Change a chapter setting via Chunk 06 settings (or directly via API in this chunk) → `system_audit` message appears in `#chapter-audit` for all members.
- [ ] **Burst test:** sender posts 4 messages within 60s in `#general` to a recipient who's offline → recipient receives ONE bundled push.
- [ ] Recipient with `#general` preference set to `off` receives no push for `/announce` posted elsewhere (only `#announcements` triggers them).
- [ ] Disabling the `polls` module in DB (`enabled_modules.polls = false`) hides `/poll` from the slash palette on next reload.

## Handoff

- Branch `claude/redesign-chunk-05-chat-integrations`. PR title `Chunk 05 — Chat integrations + push`.
- Body: link this brief, attach short screen recording of the `/poll` flow if practical (a PNG sequence is fine too).
- Status tracking: the issue's open/closed state is the status — close it via `Closes #N`. When this chunk ships, flip its row in the `spec/README.md` roadmap table (the source-of-truth status table). No project-board move.
