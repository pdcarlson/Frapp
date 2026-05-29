# Chunk 04 — Chat (the magnum opus) — part 1: foundation + hot-path client

**Depends on:** Chunk 02 (chat schema + Edge Functions + theme hooks).
**Unblocks:** 05 (chat integrations), 11 (mobile parity).

## ⛔ Blocking prerequisites — resolve before wiring or deploying the Edge Functions

The Chunk 02 Edge Functions (`chat-send`, `chat-react`) shipped as scaffolds with **two known cross-chapter auth-bypass holes**. They use the service-role client (RLS bypassed) on client-supplied `channel_id` / `message_id` without verifying the caller belongs to the target chapter. This chunk wires those functions into the web composer — **do not** do that (and do not deploy them) until both are fixed:

- [x] **[#233](https://github.com/pdcarlson/Frapp/issues/233)** — `chat-send` must authorize channel/chapter before the service-role write. *(Phase 0, branch `claude/chat-authz-hardening`.)*
- [x] **[#234](https://github.com/pdcarlson/Frapp/issues/234)** — `chat-react` must authorize message/chapter before the service-role write (+ dedup-on-conflict instead of 500). *(Phase 0.)*

> **Phase 0 status:** resolved on a dedicated security branch `claude/chat-authz-hardening` (also closes [#242](https://github.com/pdcarlson/Frapp/issues/242), [#243](https://github.com/pdcarlson/Frapp/issues/243), [#261](https://github.com/pdcarlson/Frapp/issues/261)). A single pure predicate `canAccessChannel` in `@repo/validation` is reused by the NestJS chat + search services and both Edge Functions. The chat-foundation UI build (Phase 1) starts once that PR merges.

If those issues aren't closed when you start, fix them as the first commits of this chunk (or pause and flag it). Then, as part of this chunk:

- Add **authorization integration tests** for the hot path: a member can send/react in their own channel; a non-member targeting another chapter's channel/message gets 403.
- Runtime-verify the functions against a running stack per **[#235](https://github.com/pdcarlson/Frapp/issues/235)** (the CI runtime-verification job). If your sandbox can't run Supabase, say so and lean on that CI job — do not check the runtime boxes blind.

## Read first

1. `spec/redesign-context.md` — *Architecture: Chat as the spine*, *System architecture for the chat hot path* (whole section), *Theming model*.
2. Existing chat code (if any): `apps/web/app/(dashboard)/chat/**` and `apps/web/components/chat/**`. Treat the existing implementation as a rewrite target — most of it will be replaced.
3. Edge Functions from Chunk 02: `supabase/functions/chat-send/`, `supabase/functions/chat-react/`.
4. Theme hook from Chunk 02: `apps/web/lib/hooks/use-chapter-theme.ts`.
5. Supabase Realtime docs: use the MCP `query-docs` for `@supabase/supabase-js` Realtime channel patterns (Postgres Changes vs Broadcast).
6. **`spec/redesign-context.md` → *Engineering principles*.** Non-negotiable for every chunk; the bullets below are this chunk's specific applications.

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
- Move the issue to *In Review* on the *Frapp Launch* GitHub project.

## Phase 1 — scoping notes (recorded with the implementation)

Edits made during the build that diverge from the brief above:

- **Toast plumbing:** the chat surface uses `@/hooks/use-toast` (the existing dashboard convention used by every other screen) rather than `sonner`. Functionally equivalent for our needs; sonner remains available repo-wide.
- **WYSIWYG composer scope:** Tiptap StarterKit + Placeholder is wired, with `Cmd+/` opening the slash palette and `Enter`/`Shift+Enter` submit/newline. *Live* `@`-mention and `#`-channel suggestion popovers (Tiptap Mention extension with a data-backed suggestion renderer) are deferred — the API surface for member search lands with Chunk 09, and the channel-ref suggestion is naturally Chunk 05's concern alongside the rich-message renderers. The Mention extension package is installed so Chunk 05 can drop in the suggestion popovers without re-architecting the editor.
- **Slash palette:** built on the already-installed `cmdk` library (the same dependency that powers the existing dashboard command menus) rather than hand-rolled. Filters via `useOrgConfig().isModuleEnabled` exactly as specified.
- **Reactions / un-react:** confirmed per the locked decision — adds go through `chat-react`, removes go through a direct RLS-protected delete on `chat_message_actions` (the existing `chat_message_actions_delete` policy scopes deletes to the viewer's own rows). The merged hardened Edge Function is untouched.
- **Realtime filter compromise:** documented in `spec/architecture.md` ADR-05. `chat_message_actions` has no `channel_id` column, so reactions stream through one **global** Postgres Changes subscription owned by the realtime manager and are dispatched into whichever channel cache holds the message. Reactions on not-yet-loaded messages are intentionally dropped (backfill recovers them).
- **Channel unread / mute:** the channel-list renders unread badges and mute pills when the data is present, but no unread-tracking endpoint exists yet; flagged for a follow-up issue. `useMarkChannelRead` exists but the read-cursor → unread-count machinery is out of scope for the foundation chunk.
- **Visual baseline attestation gap:** closed in [#311](https://github.com/pdcarlson/Frapp/issues/311). The Playwright snapshot `apps/web/tests/visual/dashboard-routes.spec.ts-snapshots/chat-main-content-linux.png` was last refreshed in Chunk 01 (pre-rewrite) and #278 did not regenerate it. The static analysis recorded in `apps/web/tests/visual/README.md` (per-route attestation section) explains why the rewrite is invisible to that test — both pre- and post-rewrite code paths early-return the same "select an active chapter" empty Card under the unauthenticated, no-active-chapter session that the test exercises. The `web-visual-regression` CI job is the authoritative runtime confirmation.
