# Chunk 04 — Chat (the magnum opus) — part 1: foundation + hot-path client

**Depends on:** Chunk 02 (chat schema + Edge Functions + theme hooks).
**Unblocks:** 05 (chat integrations), 11 (mobile parity).

## ⛔ Blocking prerequisites — resolve before wiring chat onto the data layer

The chat-authorization gap spans **both** layers, not just the Edge Functions: every chat write and read currently trusts client-supplied `channel_id` / `message_id` without verifying the caller belongs to the target chapter. Building the chat UI on this base is building on sand.

**Chat-authorization cluster (all open; must close before / as the opening of this chunk):**

- **[#233](https://github.com/pdcarlson/Frapp/issues/233)** — Edge `chat-send`: authorize channel/chapter before the service-role write.
- **[#234](https://github.com/pdcarlson/Frapp/issues/234)** — Edge `chat-react`: authorize message/chapter before the service-role write **and** dedup-on-conflict (no 500 on the race).
- **[#242](https://github.com/pdcarlson/Frapp/issues/242)** — NestJS `chat.service.sendMessage` (cold-path sibling of #233): no sender-membership check today.
- **[#243](https://github.com/pdcarlson/Frapp/issues/243)** — NestJS `chat.service.getMessages` (cold-path read backfill used by reconnect): no channel/chapter membership check.
- **[#261](https://github.com/pdcarlson/Frapp/issues/261)** — global chat search results not filtered by channel access (fold in only if this chunk ships search; otherwise carry to Chunk 05).

**Recommended split: two PRs.**

- **Phase 0 — chat authorization hardening (separate PR, lands first):** branch `claude/chat-authz-hardening`. Closes the four-issue core cluster (and #261 if in scope). Reuse the existing chapter-membership predicate/helper rather than inventing one. Tests are the contract (unit-level at minimum; runtime integration is gated on the sandbox-can't-run-Supabase situation tracked by **[#235](https://github.com/pdcarlson/Frapp/issues/235)**).
- **Phase 1 — Chunk 04 chat foundation (this brief):** wire the now-authorized data paths into the 3-pane UI + optimistic/offline/reconnect hot-path client.

If those issues aren't closed when you start, land Phase 0 first. Do not build Phase 1 on an unauthorized base.

Then, as part of Phase 1, add **authorization integration tests** that exercise the wired path (a member can send/read/react in their own channel; a non-member targeting another chapter's channel/message gets 403) and runtime-verify per #235 — never tick the runtime boxes blind.

## Read first

1. `docs/internal/redesign/master-plan.md` — *Architecture: Chat as the spine*, *System architecture for the chat hot path* (whole section), *Theming model*.
2. Existing chat code (if any): `apps/web/app/(dashboard)/chat/**` and `apps/web/components/chat/**`. Treat the existing implementation as a rewrite target — most of it will be replaced.
3. Edge Functions from Chunk 02: `supabase/functions/chat-send/`, `supabase/functions/chat-react/`.
4. Theme hook from Chunk 02: `apps/web/lib/hooks/use-chapter-theme.ts`.
5. Supabase Realtime docs: use the MCP `query-docs` for `@supabase/supabase-js` Realtime channel patterns (Postgres Changes vs Broadcast).
6. **`docs/internal/redesign/master-plan.md` → *Engineering principles*.** Non-negotiable for every chunk; the bullets below are this chunk's specific applications.

## Engineering principles applied here

- **Actor identity comes from the authenticated session, never a literal.** Every chat write — `send`, `react`, `action`, `read-cursor` — sources the actor from the Supabase session (client) or `req.user.id` (server). The prototype's `chat.jsx toggleReact` hardcodes `"u_05"` as the reaction owner in two places — do not port that pattern. The Edge Functions (`chat-send`, `chat-react`) read `auth.uid()` from the RLS context, not from the client payload.
- **Empty channel list renders an explicit empty state.** When the user has no visible channels (new chapter, all DMs muted, etc.), render an "All caught up — start a channel" empty component, not a blank center pane. Check `channels.length === 0` (or `!active`) before attempting to render `<ChannelHeader>` / `<MessageList>` / `<Composer>`. Same rule for: no messages in a channel ("Be the first to post"), no DM threads ("Start a conversation"), no search results.
- **`messages.find(...)` and similar lookups treat `undefined` as a real state.** Components that look up the active message (jump-to-reply, mention preview, pinned-message popover) render a graceful fallback when the message has been deleted or isn't yet loaded, rather than dereferencing properties on `undefined`.
- **Composer numeric inputs (poll-option count, etc.) guard-parse** per the master-plan rule. Same for any future slash-command argument that takes a number.
- **Interactive chat affordances are semantic** — message-action buttons are `<button>`, channel rows in the list are `<button>` (they open a channel client-side) or `Link` (if they push to a route), thread-reply triggers are `<button>`. Reaction chips are `<button>` with `aria-pressed` reflecting the viewer's vote state.

## Branch

`claude/redesign-chunk-04-chat-foundation` — from `main`.

## Goal

Rebuild the chat surface as a Slack-grade 3-pane client with the full hot-path performance stack: optimistic updates, idempotent UUIDs, offline composer queue, reconnect-with-backfill, theme-driven styling. Slash commands are scaffolded (palette opens, parser works) but rich-message renderers + push notifications land in Chunk 05.

## Tasks

### UI structure

1. Rewrite `apps/web/app/(dashboard)/chat/page.tsx` and `apps/web/components/chat/**` as a 3-pane layout:
   - **Left:** channel list. Grouped (Channels / DMs / System). Unread badges, mute, search. Pinned channels float to top.
   - **Center:** message thread. Virtualized via `react-virtuoso`. Message grouping (consecutive same-author within 5 min). Reactions quick-pick (👍 🙏 ✅ 🔥) + emoji picker. Threaded replies. Pinned messages popover. Jump-to-unread.
   - **Right:** thread / details panel, collapsible.
2. Composer: rich text (links, mentions, channel refs), file attachments (pre-signed Storage upload from client), emoji picker, slash-command palette (`/` or Cmd+/), Shift+Enter for newline.

### Hot-path client — bulk of the chunk

3. **`apps/web/lib/chat/chat-client.ts`** — single entry point for every chat action (send message, react, action on a card). Each action:
   - Generates a client UUID.
   - Writes optimistic update via TanStack Query `onMutate`.
   - POSTs to the appropriate Edge Function (`chat-send`, `chat-react`).
   - `onError` → rollback + toast. `onSuccess` → reconcile with canonical row.
4. **Postgres Changes subscriptions** — per visible channel: `chat_messages` + `chat_message_actions`. Merge inbound rows into the cache by ID (idempotent — if the local optimistic row matches, replace; if it's new, append).
5. **Broadcast subscriptions** — per visible channel: typing + presence. Throttle typing emit to once per 3s per user.
6. **Reconnect strategy:**
   - Listen to Supabase Realtime status. On disconnect, render an unobtrusive "Reconnecting…" pill near the channel header.
   - Backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s.
   - On reconnect, for each subscribed channel: read last-seen message ID (persisted in localStorage), call `GET /chat/channels/:id/messages?since=<id>` for backfill, *then* resubscribe to Realtime.
7. **Offline composer queue:**
   - Use Dexie for IndexedDB. Schema: `drafts(channelId, body, updatedAt)`, `outbox(clientId, channelId, body, attempts, queuedAt)`.
   - Drafts persist between reloads.
   - Outbox flushes in order on reconnect.
   - Failed sends (4xx) move to a `failed` state surfaced inline in the channel with a retry button.

### Theming

8. Apply derived chapter theme via `useChapterTheme()`. Specifically: sidebar tint, self-message bubble accent, mention pill colors, reaction-active color.

### Slash-command scaffold (renderers come in Chunk 05)

9. Slash-command palette opens on `/` or Cmd+/. Filterable. Reads command list from `packages/chat-integrations/` (create the package in this chunk with a minimal registry; Chunk 05 fills it). Commands are filtered by `enabled_modules` from `useOrgConfig()`.
10. Sending a `/text` message (just text, no slash) goes through `chat-send` as `kind="text"`. Slash commands without renderers in this chunk can no-op or show "Available in Chunk 05" toast — choose whichever keeps the demo cleanest.

### Spec updates

11. `spec/ui-web-dashboard.md`: chat 3-pane layout, composer, reconnect pill.
12. `spec/architecture.md`: link to Chunk 02's ADRs; add a brief note on Dexie schema for offline queue.

## Verification

- [ ] Two test users in the same chapter, two browsers: send messages, react, thread, mention, attach a file — all visible in real time on both sides.
- [ ] Theme reflects chapter colors (verify by changing `chapters.theme_palette` directly in DB and reloading).
- [ ] **Reconnect test:** in DevTools, set Network → Offline → confirm "Reconnecting…" pill → restore → backfill arrives, no dupes, no lost messages.
- [ ] **Offline composer test:** Network → Offline → compose 2 messages → reload tab → drafts persist, queue persists → Network → Online → both send in order, original timestamps reasonable.
- [ ] **Idempotency test:** open the same chapter in two tabs, race to send the same message body with a forced shared `client_message_id` (DevTools console) → only one DB row exists.
- [ ] `npm run typecheck` + `npm run lint` clean.
- [ ] Screenshots: chat with multiple channels, thread open, slash palette open, reconnect pill visible.

## Handoff

- Branch `claude/redesign-chunk-04-chat-foundation`. Push, open PR `Chunk 04 — Chat foundation + hot-path client`. Body: link this brief, attach screenshots, paste the reconnect + offline test results.
- Update `STATUS.md`.
