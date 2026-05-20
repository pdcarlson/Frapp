# Chunk 11 — Mobile (Expo) chat parity with native-grade hot path

**Depends on:** Chunk 04 (chat foundation), Chunk 05 (renderers + push worker).
**Unblocks:** mobile users can do everything web users can in chat. Ops module renderers may need follow-up RN ports if Chunk 10 sub-chunks ship renderers as web-only React components.

## Read first

1. `docs/internal/redesign/master-plan.md` — *System architecture for the chat hot path* (whole section), *Push notification rules*.
2. `packages/chat-integrations/` (Chunks 04 + 05) — renderers and registry. Need to be portable to React Native (NativeWind).
3. `apps/web/lib/chat/chat-client.ts` — port to mobile with abstracted storage layer.
4. `apps/mobile/` — existing Expo app structure.
5. Existing mobile push integration: grep `expo-notifications` / `Expo.PushTokenManager`.

## Branch

`claude/redesign-chunk-11-mobile-chat` — from `main`.

## Goal

Bring the chat experience to mobile with first-class offline + background behavior. The Expo app opens directly into chat. Web and mobile users can hold a real-time conversation across the network with parity on reactions, inline cards, voice memos, and presence.

## Tasks

1. **Renderer port:** every component in `packages/chat-integrations/` works in both web (Tailwind) and mobile (NativeWind). Where the styling is web-only today, abstract behind a thin "render primitives" layer per platform. Do not fork the registry.
2. **`chat-client.ts` port:** abstract the storage layer so web uses Dexie/IndexedDB and mobile uses AsyncStorage for drafts + SQLite (`op-sqlite` or `expo-sqlite`) for the inbound message cache. Same TanStack Query mutations / Realtime subscriptions on both platforms.
3. **Push notifications via Expo Push:**
   - Native channel categorization (announcements / mentions / DMs separately in iOS Notification Center and Android channels).
   - Silent push handler that wakes the app for background sync of new messages when the websocket isn't alive — keeps unread counts honest.
4. **Offline composer (parity with web):** drafts + send queue + reaction/RSVP/vote queue persist between cold launches.
5. **Voice memos** in the composer (mobile-native): record → upload to Storage → send as `kind="audio"` with waveform metadata.
6. **App lifecycle:**
   - On foreground, resubscribe Realtime + REST backfill since last cursor *before* rendering the channel.
   - On background, persist cursors.
   - Presence: backgrounded → `idle`, force-quit → `offline`.
7. **Default route:** authenticated entry lands on `/chat`. Channel list pane is the default tab on mobile.
8. **Spec updates:** `spec/ui-web-dashboard.md` (note web ↔ mobile parity), `docs/internal/MOBILE_TESTING.md` (add chat parity to the smoke checklist).

## Verification

- [ ] Build via `eas build --platform ios --profile development` (or local Expo Go) and sign in. Default route is chat.
- [ ] Send/receive messages and inline cards from `/poll` and `/announce` in real time between mobile and web.
- [ ] Force-quit the app, post a message from web → push arrives → tapping the push opens the relevant channel scrolled to that message.
- [ ] Airplane mode → compose 3 messages → disable airplane → all 3 send in order, no dupes (verify in DB by `client_message_id`).
- [ ] Record a voice memo, send → web client plays it back with waveform.
- [ ] Foreground after 10 min away → channel cursor honored; only the unread messages are appended; no full reload of history.
- [ ] Burst push test (mirror Chunk 05): 4 web messages in 60s → 1 bundled push on mobile.

## Handoff

- Branch `claude/redesign-chunk-11-mobile-chat`. PR title `Chunk 11 — Mobile chat parity`.
- Attach a short screen capture of the web ↔ mobile real-time interaction if practical.
- Update `STATUS.md`.
