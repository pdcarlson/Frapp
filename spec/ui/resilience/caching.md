# Caching strategy

> Part of [Network resilience](README.md).

## Cache Layers

| Layer | Storage | TTL | Purpose |
|-------|---------|-----|---------|
| TanStack Query memory | In-memory | `staleTime` / `gcTime` per query | Active session data. Web: `apps/web/lib/providers/query-provider.tsx`. Mobile: `apps/mobile/lib/query-client.ts`. A refresh or process death discards it; the next load refetches. |
| Chat outbound (web) | IndexedDB — `frapp-chat` | Until sent | Drafts and the outbox. **Outbound work, not a read cache**: not dropped on an identity change, because that would lose a message. Scoped by key instead — drafts under `[userId+channelId]`, outbox rows under `[userId+chapterId+clientId]`, `userId` being the Supabase auth uid ([#2226](https://github.com/pdcarlson/Frapp/issues/2226)) — so a shared browser keeps each member's unsent work for their own next sign-in and reachable by nobody else. [`apps/web/lib/chat/offline-queue.ts`](../../../apps/web/lib/chat/offline-queue.ts). |
| Chat first chunk (web) | IndexedDB — `frapp-chat-read-cache` | 7 days, or until the identity changes | The channel list and the last 30 **confirmed** messages of up to 3 recently-read channels, so a cold load paints without waiting on `GET /v1/channels`. Board `1s`'s "first chunk". [`apps/web/lib/chat/first-chunk-cache.ts`](../../../apps/web/lib/chat/first-chunk-cache.ts). |
| Chapter accent (web) | Cookie — `signet_chapter_accent` | 30 days, or until the identity changes | The seven semantic accent tokens for the member's current chapter, so the **first paint** of a cold load is the chapter's colour instead of `signet.css`'s house gold. Read by the `(dashboard)` layout, not by the client — see below. [`apps/web/lib/theme/accent-cache.ts`](../../../apps/web/lib/theme/accent-cache.ts). |
| Service Worker (future) | Cache API | Varies | Offline asset caching |

**Correction (2026-09-10):** an earlier revision of this table listed a third layer, `localStorage` via `persistQueryClient` with a 24-hour TTL so the product cache would survive page refreshes. That layer never existed — there is no `persistQueryClient`, persister, or `@tanstack/query-persist*` dependency — and it is not intended. The product cache is in-memory only. Sign-out and same-device account-swap drop that in-memory cache (owned by [`multi-tenancy.md`](../../behavior/multi-tenancy.md)); a 24h snapshot would restore `["user","me"]` / `["settings"]` after those clears.

**The first-chunk row is not that layer returning under another name.** The objection above is about *which keys a persister picks up*, and a persister picks up all of them by construction — which is how `["user","me"]` and `["settings"]` would outlive a sign-out. The first-chunk cache stores two named row types and nothing else, and each row carries the **Supabase auth uid + chapter id it was written under as part of its primary key**, so there is no key under which another member's or another chapter's row can be read back. Keying, not clearing, is what prevents the cross-tenant read; the clearing is hygiene on top of it, and comes in two halves:

- `dropCacheWhenIdentityChanges` ([`frapp-client-provider.tsx`](../../../apps/web/lib/providers/frapp-client-provider.tsx)) deletes the whole database on the same two events that drop the in-memory cache — a chapter change and an auth-uid change, sign-out included.
- That delete is asynchronous, un-awaited, and may not land: the sign-out and chapter-switch controls navigate away moments later, `/join` and the onboarding wizard change chapter in place with no navigation at all, and a second tab holding the database open makes the delete *blocked*. `pruneForeignScopes` is the backstop — it runs on every read and deletes every row outside the current scope. It runs *after* the seed, not before: a read is a lookup at the current scope and cannot reach a foreign key, so putting a key scan in front of the paint would cost the milliseconds the cache exists to save.

Two consequences worth stating rather than leaving to be rediscovered: a member who alternates between two chapters pays a cold load on each swap, which is the conservative side of [`multi-tenancy.md`](../../behavior/multi-tenancy.md)'s "a chapter switch drops the outgoing chapter's data"; and the read cache lives in a **separate IndexedDB database** from drafts and the outbox specifically so "drop every cached row and none of the queued ones" is one call rather than a list of tables to keep correct.

**The accent cache is a cookie, and that is not a third storage opinion — it is the only store that can answer the question in time.** `signet.css` bakes the house-default accent slot, so the wrong gold is on screen the moment the stylesheet lands, before any script runs. IndexedDB and `localStorage` are both read after that paint — IndexedDB because it is asynchronous, `localStorage` because the earliest a client can run is hydration — so either would shorten the flash rather than remove it. A cookie is in the request, so the `(dashboard)` layout (already an async server component, already reading the nav-collapse cookie for the same class of reason — [`nav-collapse.ts`](../../../apps/web/components/layout/nav-collapse.ts)) can put the accent in the markup the browser parses. Dexie would also have to be dropped onto the shell path to get there, which [`first-chunk-wipe.ts`](../../../apps/web/lib/chat/first-chunk-wipe.ts) exists to prevent: it is ~31 KB gzipped against a shell floor of ~248 KB, paid by every dashboard route to serve one.

**Reading it server-side is also what makes the key enforceable.** The row carries the auth uid and chapter id it was written under, and [`server-accent.ts`](../../../apps/web/lib/theme/server-accent.ts) looks it up at the scope *the request's own access token* names — decoded, never verified, because this chooses a colour and not an authorisation. So the same property holds as for the first-chunk rows: there is no scope under which another member's or another chapter's accent is returned. That closes the one case a client-side clear cannot reach — a browser closed without signing out, the next member signing in, and the redirect into the dashboard arriving as a full document load, with nothing hydrated yet to have cleared anything. `clearCachedAccent()` runs beside `wipeFirstChunkCache()` on the same two events and is hygiene on the same terms.

Two limits worth stating. Only the **current** scope is kept, so a member alternating between two chapters pays one flash per switch — the same conservative side of [`multi-tenancy.md`](../../behavior/multi-tenancy.md)'s "a chapter switch drops the outgoing chapter's data" that the chat read cache takes. And the cookie rides on every request to the Next origin (the API is a different origin and never sees it) at **295 bytes encoded, 317 with its name** — which is the budget that keeps this to the accent slot rather than growing into a general chapter-config cache.

**The outbound database is scoped but never wiped, and that asymmetry is the point.** Both IndexedDB databases now key every row on the identity that wrote it, because keying is the security boundary in both. They part company on the hygiene: the read cache is deleted on an identity change and prunes foreign scopes on every read, while `frapp-chat` does neither. A queued row is a message the member composed and has not sent, so deleting it on sign-out — or sweeping it as "foreign" when the next member arrives, which is the same deletion under another name — is precisely what [`principles.md`](principles.md) §5 forbids. The scoped keys are what make keeping it safe: member A's unsent messages wait for A's next sign-in on that browser and are unreadable, unflushable and unmutable by anyone else in the meantime.

Two costs of that, stated rather than implied. An abandoned profile holds one member's unsent text on disk indefinitely; bounding it by age is a separate data-loss decision nobody has taken. And the #2226 migration **drops every pre-scoping draft and queued row** — a v1 row records no member, so there is no one to migrate it to, and handing it to whoever opens the database next would be the cross-account authorship bug being fixed, performed by the migration instead of the flush.

**The two databases read identity differently, and that asymmetry is load-bearing too.** Both key on the Supabase auth uid, but the read cache takes it live from `useAuthUserId` while the outbound store remembers the last member seen signed in during this page session. `useAuthUserId` answers "is there a valid session right now", which is a different question from "whose browser is this": it is `null` on every mount until its effect resolves — and `ChatProvider` remounts on an in-app navigation to `/chat` while the channel list is still warm — and `null` again for the whole of an offline period once the access token has expired and the refresh cannot reach the network. Neither means signed out. A read cache may safely go cold on that uncertainty; an outbox may not, because going cold there means declining to persist an unsent message, which [`principles.md`](principles.md) §5 ranks above a cold cache. The memory is module-scoped rather than stored, so a fresh page load starts empty and nothing carries into another member's session. Where there is genuinely no scope — nobody signed in, or no active chapter — the store **fails an enqueue rather than returning a row it did not keep**: reporting a queued message that was never written is the silent loss the outbox exists to prevent.

The outbox carries `chapterId` and drafts do not, which is not an oversight either. A channel id is unique across chapters, so `[userId+channelId]` isolates a draft completely. A *flush*, though, is a send, and sends carry the active chapter in a header that `ChatService.sendMessage` checks against the channel — so a row queued in one chapter and flushed from another is a 4xx that burns a legitimate message. Scoping the queue by chapter leaves those rows queued until the member is back in the chapter they wrote them for.

## Per-Domain Cache Configuration

| Domain | staleTime | gcTime | Rationale |
|--------|----------|---------|-----------|
| Members | 60s | 10min | Changes rarely, can tolerate staleness |
| Roles | 60s | 10min | Changes very rarely |
| Events | 30s | 5min | New events / check-ins moderately frequent |
| Points / Leaderboard | 30s | 5min | Points change frequently during events |
| Chat messages | `Infinity` | _(default)_ | Realtime, not polling, keeps this cache fresh, so it opts out of staleness entirely — owned by [`web-dashboard/README.md`](../web-dashboard/README.md) § Surviving data contracts. `use-chat-channel.ts` sets only `staleTime`, on web and mobile alike, so `gcTime` falls through to each app's own default: **10 minutes on web** (`query-provider.tsx`) and **TanStack's 5-minute default on mobile**, whose `query-client.ts` sets no `gcTime`. Recorded as-is rather than as an intent nothing implements |
| Chat channels | 60s | 10min | Channel list changes rarely |
| Notifications | 10s | 5min | Time-sensitive, refresh often |
| Backwork | 60s | 10min | Content changes infrequently |
| Settings | 5min | 30min | Very rarely changes |
| Invoices | 30s | 5min | Status transitions are time-sensitive |
| Service entries | 30s | 5min | Approval queue is time-sensitive |
| Tasks | 30s | 5min | Status changes are frequent |
| Study sessions | 30s | 5min | The **live** session is not served from this cache at all — s10 holds it in screen state and refreshes it from each mutation's own response, because a session can end by returning 200 and a 30s window would keep a dead timer ticking. The cached list backs the history and the recovery-on-mount read |
| Study zones | 60s | _(default)_ | A chapter's zones change about as often as its roles. `useGeofences` sets only `staleTime`, so `gcTime` falls through to each app's own default exactly as the Chat messages row above sets out — recorded as-is rather than as an intent nothing implements |

## Cache Invalidation Triggers

| Event | Invalidate |
|-------|-----------|
| User sends message | `['messages', channelId]` |
| User creates event | `['events', chapterId]` |
| User adjusts points | `['points', chapterId]`, `['leaderboard']` |
| User changes roles | `['members', chapterId]`, `['roles']` |
| Supabase Realtime event | Relevant query key (auto-updated) |
| Window focus (tab switch) | All stale queries (TanStack built-in) |
| Network reconnect | Mounted, enabled queries. Web forces even fresh ones (`refetchOnReconnect: "always"`); mobile leaves the default, so only stale ones refetch. Separately, a fetch the drop left paused resumes regardless of observers |

**Those last two rows are delivered on mobile, not merely specified.** They depend on
TanStack's `onlineManager` and `focusManager`, which nothing wired until
`apps/mobile/lib/connection/query-connectivity.ts` bound both to the connection
monitor — so `refetchOnReconnect` (a TanStack default) now actually fires. Two mobile
specifics: `DEGRADED` is published as **online**, because requests there are slow or
intermittent rather than impossible and telling TanStack otherwise would pause every
retry exactly when a retry is what recovers; and there is no window, so `focusManager`
is driven by `AppState` — `"active"` only, since iOS `inactive` is Control Center and
the app switcher, not a background. The explicit retry controls on s04/s06 stay
regardless: they are still the only recovery from a *server* error, which no amount of
connectivity signalling fixes.

---
