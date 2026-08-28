import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import { useEffect, useMemo, useRef } from "react";
import { readAuthToken } from "./auth-token";
import { useAuthSession } from "./auth-session";

export { AUTH_TOKEN_STORAGE_KEY } from "./auth-token";
export { useIsApiAuthenticated } from "./use-is-api-authenticated";

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
const queryClient = new QueryClient({
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

export function FrappProvider({ children }: { children: React.ReactNode }) {
  const { chapterId } = useAuthSession();

  // The SDK's `getChapterId` is synchronous and baked into the client's
  // middleware, so it reads through a ref. Rebuilding the client on every
  // chapter change (as web does) would drop in-flight requests for no gain —
  // the middleware already runs per request.
  const chapterIdRef = useRef(chapterId);
  useEffect(() => {
    chapterIdRef.current = chapterId;
  }, [chapterId]);

  /* eslint-disable react-hooks/refs -- getChapterId is invoked per request by SDK middleware, not while constructing the client; capturing chapterId would stale in-flight calls */
  const client = useMemo(
    () =>
      createFrappClient({
        // Bare origin — the generated SDK paths already carry `/v1`.
        baseUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001",
        getAuthToken: readAuthToken,
        getChapterId: () => chapterIdRef.current,
      }),
    [],
  );
  /* eslint-enable react-hooks/refs */

  return (
    <QueryClientProvider client={queryClient}>
      <FrappClientProvider client={client} chapterId={chapterId}>
        {children}
      </FrappClientProvider>
    </QueryClientProvider>
  );
}
