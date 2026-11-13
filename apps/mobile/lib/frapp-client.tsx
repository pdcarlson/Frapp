import { QueryClientProvider } from "@tanstack/react-query";
import { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import { dropAllKeptDrafts } from "@repo/hooks/kept-drafts";
import { useEffect, useMemo, useRef } from "react";
import { readAuthToken } from "./auth-token";
import { readClientVersion } from "./client-version";
import { useAuthSession } from "./auth-session";
import { queryClient } from "./query-client";
import { forgetDuesMemory } from "./dues/visit-memory";
import { createRejectedSessionHandler } from "./rejected-session";
import { createFreshAuthTokenReader } from "./fresh-auth-token";
import { getSupabaseClient } from "./supabase";


export function FrappProvider({ children }: { children: React.ReactNode }) {
  const { chapterId, userId, signOut } = useAuthSession();
  const signOutRef = useRef(signOut);
  useEffect(() => {
    signOutRef.current = signOut;
  }, [signOut]);

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
   * Keying the effect on the chapter id covers `lib/select-chapter.ts` and the
   * picker. A magic-link account swap also derives `chapterId` to null, which
   * hits this path — but that is not the product-cache owner. Two accounts can
   * share a chapter, and both-null chapters skip this effect; unscoped keys
   * (`["user","me"]`, `["settings"]`) are dropped in `auth-session.tsx`
   * `applySession` when the auth uid changes.
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
    // A chapter switch ends Dues' hold (`spec/ui/mobile/screens.md` s11).
    forgetDuesMemory();
    // And every form draft kept for a screen to come back to (#4593).
    dropAllKeptDrafts();
  }, [chapterId]);

  // A form draft kept for a screen to come back to (#4593) is the signed-in
  // member's: signing out or into another account drops them all. Their keys
  // carry the user too, so this only frees what nobody can open now.
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (previous === undefined || previous === userId) return;
    dropAllKeptDrafts();
  }, [userId]);

  /* eslint-disable react-hooks/refs -- getChapterId is invoked per request by SDK middleware, not while constructing the client; capturing chapterId would stale in-flight calls */
  const client = useMemo(() => {
    const readFreshToken = createFreshAuthTokenReader({
      readToken: readAuthToken,
      getSupabase: getSupabaseClient,
    });
    const checkRejectedSession = createRejectedSessionHandler({
      getSupabase: getSupabaseClient,
      signOut: () => signOutRef.current(),
    });
    return createFrappClient({
        // Bare origin — the generated SDK paths already carry `/v1`.
        baseUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001",
        // The mirrored token, refreshed first when it is about to expire, so a
        // foreground refetch never goes out with the token the OS let lapse
        // in the background (#3907). `lib/fresh-auth-token.ts`.
        getAuthToken: readFreshToken,
        getChapterId: () => chapterIdRef.current,
        // Read once: a running process never changes its native build.
        clientVersion: readClientVersion(),
        // A 401 means the API no longer accepts this session (an account
        // deleted on another device, most often): sign out once, for every
        // screen. `lib/rejected-session.ts`.
        // The reader's learned clock offset is dropped first: a 401 means a
        // token it called current wasn't (`lib/fresh-auth-token.ts`).
        onUnauthorized: () => {
          readFreshToken.forgetClockOffset();
          checkRejectedSession();
        },
      });
  }, []);
  /* eslint-enable react-hooks/refs */

  return (
    <QueryClientProvider client={queryClient}>
      <FrappClientProvider client={client} chapterId={chapterId} userId={userId}>
        {children}
      </FrappClientProvider>
    </QueryClientProvider>
  );
}
