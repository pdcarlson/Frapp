import { QueryClient, type Query } from "@tanstack/react-query";
import { isRetryableFailure, statusOf } from "@repo/api-sdk";
import {
  markChannelReadMutationKey,
  markNotificationReadOnOpenMutationKey,
} from "@repo/hooks";
import { createReportingCaches } from "@/lib/sentry/query-errors";
import { forgetDuesMemory } from "@/lib/dues/visit-memory";
import { forgetCachedChatPhotos } from "@/lib/chat/photo-cache";
import { forgetUnreadMemory } from "@/lib/chat/unread-memory";

/**
 * `networkMode: "offlineFirst"` is load-bearing, not a tuning knob.
 *
 * C8 (#998) wired TanStack's `onlineManager` to real connectivity
 * (`lib/connection/query-connectivity.ts`). Under the default
 * `networkMode: "online"` that has a consequence nothing else in the app wants:
 * while offline, a query or mutation is **paused** rather than attempted, so it
 * never settles. Concretely — the s18 check-in scan would spin on "Checking you
 * in…" forever with no error and a dead camera, s14's Mark-all-read would
 * spin forever, and the explicit "Try again" controls on s04/s06 would become
 * silent no-ops (a paused query leaves `isFetching` false, so the button neither
 * spins nor errors). That is the dead end `spec/ui/design-system/README.md` §5
 * rule 2 bans, delivered by a default.
 *
 * `"offlineFirst"` attempts the request once and lets it fail visibly, pausing
 * only the *retries* until connectivity returns. Every one of those surfaces
 * gets an honest error it can report, and `refetchOnReconnect` still fires.
 *
 * `refetchOnWindowFocus` is on for the same slice: `focusManager` is now bound
 * to `AppState`, so "focus" finally means something on a device, and
 * `spec/ui/resilience/caching.md` asks for stale queries to refetch on it. With a
 * 60s `staleTime` and tabs that stay mounted for the whole session, this is what
 * stops a member returning after an hour to hour-old channels and tasks.
 */
/**
 * The app's product `QueryClient`: every product query lives here, and
 * sign-out, an account swap and a chapter switch clear it wholesale.
 *
 * It is not the only one. The minimum-version answer lives in
 * `clientPolicyQueryClient` (`lib/client-policy.ts`) precisely so those clears
 * can't erase an update block (#2526). Don't fold it back in.
 *
 * It lives here, rather than beside `FrappProvider`, so that
 * `lib/auth-session.tsx` can clear it on sign-out **and** on auth-uid swap
 * without importing from `lib/frapp-client.tsx` — which already imports
 * `useAuthSession` and would therefore form an import cycle. `app/_layout.tsx`
 * nests `AuthSessionProvider` *outside* `FrappProvider` (the API client reads
 * the session's token), so `useQueryClient()` is not reachable from the auth
 * provider and the module singleton is the only seam available. That layout
 * file is one of #937's frozen seven, so this module is what keeps the fix off
 * it.
 *
 * Its caches report every final failure to Sentry (`lib/sentry/query-errors.ts`,
 * #3377).
 */
export const queryClient = new QueryClient({
  ...createReportingCaches(),
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

/**
 * One more attempt for a failure that may pass next time (a dropped
 * connection, a 5xx), never for a definitive refusal
 * (`spec/ui/resilience/api-retry.md` § Writes).
 */
function retryOnceIfRetryable(
  failureCount: number,
  error: unknown,
): boolean {
  return failureCount < 1 && isRetryableFailure(error);
}

/**
 * Idempotent, fire-and-forget writes the app sends as something opens retry
 * once (#3747). Every other mutation keeps `retry: 0`.
 *
 * The case is a resume. iOS tears down a suspended app's sockets, and what a
 * notification tap sends the moment the app comes back (its read receipt, and
 * the mark-read of the thread it opens) can die on the dead connection.
 * FRAPP-MOBILE-F and J were unkeyed mutations that died that way as
 * chat-thread opened, which makes mark-read the likely one. The retryer won't
 * continue while unfocused, and `lib/connection/query-connectivity.ts` holds
 * focus until the connection monitor's foreground probe has its verdict, so
 * the retry waits out the probe instead of following the failure onto the dead
 * connection at once. The verdict can be a failure, so this narrows the window
 * rather than promising a working connection.
 *
 * Only writes nobody awaits belong here. A retry parks while the monitor reads
 * OFFLINE (`networkMode: "offlineFirst"`), which is right for a stamp sent and
 * forgotten and a dead end for anything a spinner waits on: s14's Mark all read
 * awaits every write in its batch. A non-idempotent write must not join either:
 * it keeps failing visibly (`spec/ui/design-system/README.md` §5 rule 2).
 *
 * - Channel mark-read (`useMarkChannelRead`, every caller: thread focus and
 *   blur, the channel menu's Mark as read, all `mutate`) stamps the read cursor
 *   to the server's clock, so a replay only re-stamps it. Lost, it leaves the
 *   badge counting a thread the member read.
 * - A push tap's notification receipt (`useMarkNotificationRead({ sentOnOpen:
 *   true })`) sets `read_at` the same way. Lost, the tapped notification stays
 *   unread. The inbox's taps and Mark all read use the shorter key, which this
 *   default doesn't match (a default's key must prefix the mutation's).
 *
 * Not covered: chat's resume resync re-stamps the open thread with a direct
 * call, not this mutation (`createChatActivityHandler` in `@repo/hooks`, #3764).
 */
for (const mutationKey of [
  markChannelReadMutationKey,
  markNotificationReadOnOpenMutationKey,
]) {
  queryClient.setMutationDefaults(mutationKey, { retry: retryOnceIfRetryable });
}

/**
 * Retrying what the API refused for a lapsed sign-in token, once a new token
 * for the same member has arrived.
 *
 * A member back from the background can have their first round of requests
 * go out with a token that lapsed while the app was suspended, before the
 * refresh lands (FRAPP-API-E, ios/0.11.0+20, 2026-11-12). Focus has already
 * fired by then, so a screen that read one of those 401s kept its error state
 * until the member pulled to refresh or left the app and came back. These
 * turn that into a moment of loading instead.
 *
 * Each token change is a new generation. A query whose 401 answers a request
 * sent under an earlier generation is retried once, whether it failed before
 * the new token arrived ({@link noteRefreshedSignInToken}'s sweep) or after
 * it, its request still in flight when the refresh landed (the cache listener
 * below). A query refused under the current generation is left on its error:
 * that 401 is about the new token, and `onUnauthorized` decides what it means.
 * A retry runs under the current generation, so none of this can loop.
 */
let signInGeneration = 0;
const generationSentUnder = new WeakMap<Query, number>();

function refusedForSignIn(error: unknown): boolean {
  return statusOf(error) === 401;
}

function retryUnderCurrentToken(query: Query): void {
  generationSentUnder.set(query, signInGeneration);
  void queryClient.refetchQueries({ predicate: (candidate) => candidate === query });
}

queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== "updated") return;
  const { query, action } = event;
  if (action.type === "fetch") {
    generationSentUnder.set(query, signInGeneration);
    return;
  }
  if (
    action.type === "error" &&
    refusedForSignIn(action.error) &&
    generationSentUnder.get(query) !== signInGeneration
  ) {
    retryUnderCurrentToken(query);
  }
});

/**
 * A new token for the same member, in the same chapter, has arrived: retry
 * every query that is sitting on a 401 from an earlier one. The auth session
 * calls this; a chapter switch doesn't, because its own cache clear refetches
 * everything once the new chapter is committed.
 */
export function noteRefreshedSignInToken(): void {
  signInGeneration += 1;
  for (const query of queryClient.getQueryCache().getAll()) {
    if (
      query.state.status === "error" &&
      refusedForSignIn(query.state.error)
    ) {
      retryUnderCurrentToken(query);
    }
  }
}

/**
 * Drop every cached query for the current product session.
 *
 * `signOut` and an in-place auth-uid change both call this. Several keys are
 * not account-scoped (`["settings"]`, `["user","me"]`), so a magic-link swap
 * that stays `authenticated` would otherwise keep the previous member's rows.
 */
export function clearProductQueryCache(): void {
  queryClient.clear();
  // Dues' captured payments outlive its screen, so they go with the cache.
  forgetDuesMemory();
  // So do chat photos cached on disk, which outlive the session entirely.
  forgetCachedChatPhotos();
  // And the unread counts saved for the next launch's first paint (#4006).
  forgetUnreadMemory();
}
