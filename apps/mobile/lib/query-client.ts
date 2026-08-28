import { QueryClient } from "@tanstack/react-query";

/**
 * `networkMode: "offlineFirst"` is load-bearing, not a tuning knob.
 *
 * C8 (#998) wired TanStack's `onlineManager` to real connectivity
 * (`lib/connection/query-connectivity.ts`). Under the default
 * `networkMode: "online"` that has a consequence nothing else in the app wants:
 * while offline, a query or mutation is **paused** rather than attempted, so it
 * never settles. Concretely — the s18 check-in scan would spin on "Checking you
 * in…" forever with no error and a dead camera, s14's Mark-all-read would stick
 * on "Marking…", and the explicit "Try again" controls on s04/s06 would become
 * silent no-ops (a paused query leaves `isFetching` false, so the button neither
 * spins nor errors). That is the dead-end `components.md` §5 bans, delivered by
 * a default.
 *
 * `"offlineFirst"` attempts the request once and lets it fail visibly, pausing
 * only the *retries* until connectivity returns. Every one of those surfaces
 * gets an honest error it can report, and `refetchOnReconnect` still fires.
 *
 * `refetchOnWindowFocus` is on for the same slice: `focusManager` is now bound
 * to `AppState`, so "focus" finally means something on a device, and
 * `spec/ui/resilience.md` § 8 asks for stale queries to refetch on it. With a
 * 60s `staleTime` and tabs that stay mounted for the whole session, this is what
 * stops a member returning after an hour to hour-old channels and tasks.
 */
/**
 * The app's single `QueryClient`.
 *
 * It lives here, rather than beside `FrappProvider`, so that
 * `lib/auth-session.tsx` can clear it on sign-out without importing from
 * `lib/frapp-client.tsx` — which already imports `useAuthSession` and would
 * therefore form an import cycle. `app/_layout.tsx` nests
 * `AuthSessionProvider` *outside* `FrappProvider` (the API client reads the
 * session's token), so `useQueryClient()` is not reachable from the auth
 * provider and the module singleton is the only seam available. That layout
 * file is one of #937's frozen seven, so this module is what keeps the fix off
 * it.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      networkMode: "offlineFirst",
      retry: 1,
      staleTime: 60_000,
    },
    mutations: {
      networkMode: "offlineFirst",
      retry: 0,
    },
  },
});
