import { QueryClientProvider } from "@tanstack/react-query";
import { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import { useEffect, useMemo, useRef } from "react";
import { readAuthToken } from "./auth-token";
import { useAuthSession } from "./auth-session";
import { queryClient } from "./query-client";

export { AUTH_TOKEN_STORAGE_KEY } from "./auth-token";
export { useIsApiAuthenticated } from "./use-is-api-authenticated";
export { queryClient } from "./query-client";

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

  /*
   * Drop every cached query when the active chapter changes.
   *
   * `spec/behavior/multi-tenancy.md` makes this a required step of a chapter
   * switch, and web's `FrappProvider` has implemented it since the spec was
   * written. Mobile had no equivalent: the `QueryClient` is a module singleton
   * and nothing cleared it, so any chapter-scoped key that does not embed the
   * chapter id kept serving the outgoing chapter's rows under the incoming
   * chapter's context for as long as it stayed fresh — a cross-chapter leak in
   * the client, even though the API would reject the equivalent request.
   *
   * C4 (#1039) closed the three keys it happened to touch (`useDocuments`,
   * `useServiceEntries`, `useGeofences`) by threading the chapter id into each.
   * That is a per-key patch, not the invariant: the next hook added without a
   * chapter id in its key reintroduces the leak silently. Dropping wholesale is
   * deliberate — enumerating the affected keys is exactly the list that is
   * already incomplete, and a chapter switch invalidates the whole view anyway.
   *
   * This has to run *after* React commits the new chapter id. Clearing makes
   * mounted observers refetch, and a clear that races the commit sends those
   * refetches out under the *outgoing* chapter and repopulates the cache it just
   * emptied. An effect runs after commit, so `chapterIdRef` above already
   * carries the new chapter and every refetch this triggers is correctly scoped.
   * Keying the effect on the chapter id also covers every path that changes
   * chapters — `lib/select-chapter.ts`, the picker, a magic-link account swap —
   * rather than one helper.
   *
   * Skipped when there was no previous chapter (first paint, the claim read
   * settling, a first selection from the picker): nothing chapter-scoped can be
   * cached under a chapter yet, and clearing there would only cancel in-flight
   * bootstrap queries for no benefit. Note `chapterId` does *not* flap to null
   * on a failed claim read — `auth-session.tsx` retains the last known chapter,
   * tagged by user id — so a network blip cannot trigger a spurious clear.
   */
  const previousChapterId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const previous = previousChapterId.current;
    previousChapterId.current = chapterId;
    if (previous === undefined || previous === null) return;
    if (previous === chapterId) return;
    queryClient.clear();
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
