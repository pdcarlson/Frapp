# Caching strategy

> Part of [Network resilience](README.md).

## Cache Layers

| Layer | Storage | TTL | Purpose |
|-------|---------|-----|---------|
| TanStack Query memory | In-memory | `staleTime` per query | Active session data |
| TanStack Query persistence | `localStorage` via `persistQueryClient` | 24 hours | Survive page refreshes |
| Service Worker (future) | Cache API | Varies | Offline asset caching |

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
