# Caching strategy

> Part of [Network resilience](README.md).

## Cache Layers

| Layer | Storage | TTL | Purpose |
|-------|---------|-----|---------|
| TanStack Query memory | In-memory | `staleTime` / `gcTime` per query | Active session data. Web: `apps/web/lib/providers/query-provider.tsx`. Mobile: `apps/mobile/lib/query-client.ts`. A refresh or process death discards it; the next load refetches. |
| Chat outbound (web) | IndexedDB — `frapp-chat` | Until sent | Drafts and the outbox. **Outbound work, not a read cache**: not dropped on an identity change, because that would lose a message. Scoped by key instead — drafts under `[userId+channelId]`, outbox rows under `[userId+chapterId+clientId]`, `userId` being the Supabase auth uid ([#2226](https://github.com/pdcarlson/Frapp/issues/2226)) — so a shared browser keeps each member's unsent work for their own next sign-in and reachable by nobody else. [`apps/web/lib/chat/offline-queue.ts`](../../../apps/web/lib/chat/offline-queue.ts). |
| Chat first chunk (web) | IndexedDB — `frapp-chat-read-cache` | 7 days, or until the identity changes | The channel list and the last 30 **confirmed** messages of up to 3 recently-read channels, so a cold load paints without waiting on `GET /v1/channels`. Board `1s`'s "first chunk". [`apps/web/lib/chat/first-chunk-cache.ts`](../../../apps/web/lib/chat/first-chunk-cache.ts). |
| Service Worker (future) | Cache API | Varies | Offline asset caching |

**Correction (2026-09-10):** an earlier revision of this table listed a third layer, `localStorage` via `persistQueryClient` with a 24-hour TTL so the product cache would survive page refreshes. That layer never existed — there is no `persistQueryClient`, persister, or `@tanstack/query-persist*` dependency — and it is not intended. The product cache is in-memory only. Sign-out and same-device account-swap drop that in-memory cache (owned by [`multi-tenancy.md`](../../behavior/multi-tenancy.md)); a 24h snapshot would restore `["user","me"]` / `["settings"]` after those clears.

**The first-chunk row is not that layer returning under another name.** The objection above is about *which keys a persister picks up*, and a persister picks up all of them by construction — which is how `["user","me"]` and `["settings"]` would outlive a sign-out. The first-chunk cache stores two named row types and nothing else, and each row carries the **Supabase auth uid + chapter id it was written under as part of its primary key**, so there is no key under which another member's or another chapter's row can be read back. Keying, not clearing, is what prevents the cross-tenant read; the clearing is hygiene on top of it, and comes in two halves:

- `dropCacheWhenIdentityChanges` ([`frapp-client-provider.tsx`](../../../apps/web/lib/providers/frapp-client-provider.tsx)) deletes the whole database on the same two events that drop the in-memory cache — a chapter change and an auth-uid change, sign-out included.
- That delete is asynchronous, un-awaited, and may not land: the sign-out and chapter-switch controls navigate away moments later, `/join` and the onboarding wizard change chapter in place with no navigation at all, and a second tab holding the database open makes the delete *blocked*. `pruneForeignScopes` is the backstop — it runs on every read and deletes every row outside the current scope. It runs *after* the seed, not before: a read is a lookup at the current scope and cannot reach a foreign key, so putting a key scan in front of the paint would cost the milliseconds the cache exists to save.

Two consequences worth stating rather than leaving to be rediscovered: a member who alternates between two chapters pays a cold load on each swap, which is the conservative side of [`multi-tenancy.md`](../../behavior/multi-tenancy.md)'s "a chapter switch drops the outgoing chapter's data"; and the read cache lives in a **separate IndexedDB database** from drafts and the outbox specifically so "drop every cached row and none of the queued ones" is one call rather than a list of tables to keep correct.

**The outbound database is scoped but never wiped, and that asymmetry is the point.** Both IndexedDB databases now key every row on the identity that wrote it, because keying is the security boundary in both. They part company on the hygiene: the read cache is deleted on an identity change and prunes foreign scopes on every read, while `frapp-chat` does neither. A queued row is a message the member composed and has not sent, so deleting it on sign-out — or sweeping it as "foreign" when the next member arrives, which is the same deletion under another name — is precisely what [`principles.md`](principles.md) §5 forbids. The scoped keys are what make keeping it safe: member A's unsent messages wait for A's next sign-in on that browser and are unreadable, unflushable and unmutable by anyone else in the meantime.

Two costs of that, stated rather than implied. An abandoned profile holds one member's unsent text on disk indefinitely; bounding it by age is a separate data-loss decision nobody has taken. And the #2226 migration **drops every pre-scoping draft and queued row** — a v1 row records no member, so there is no one to migrate it to, and handing it to whoever opens the database next would be the cross-account authorship bug being fixed, performed by the migration instead of the flush.

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
