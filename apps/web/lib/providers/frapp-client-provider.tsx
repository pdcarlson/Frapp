"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuthUserId } from "@/lib/auth/use-auth-user-id";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useClaimChapterSync } from "@/lib/auth/use-claim-chapter-sync";
import { wipeFirstChunkCache } from "@/lib/chat/first-chunk-wipe";

/**
 * First value and same-value updates must not clear: those are hydrate /
 * token-refresh, not a switch. A real change (chapter or auth uid) drops the
 * whole cache because many keys are not scoped to that identity.
 *
 * The in-memory cache is not the only one any more. Chat's first-chunk read
 * cache (`lib/chat/first-chunk-cache.ts`) survives a reload by design, so the
 * same two events have to reach it — a sign-out or a chapter switch that left
 * a channel list and thirty messages on disk would be the persisted version of
 * exactly the leak this function exists to prevent.
 *
 * Two things about that call. It is **not awaited**, and nothing downstream
 * depends on it having finished: keying is what prevents a cross-tenant read,
 * and `pruneForeignScopes` deletes any foreign row on the next read. That
 * matters because the delete genuinely may not land — the sign-out and
 * chapter-switch controls navigate away moments later, `/join` and the
 * onboarding wizard change chapter in place with no navigation, and a second
 * tab holding the database open blocks it outright. And it comes from
 * `first-chunk-wipe.ts` rather than from the cache module itself, because this
 * provider is on the shell path of every dashboard route and that module
 * imports Dexie — see that file's header for the bundle argument.
 */
function dropCacheWhenIdentityChanges(
  previousRef: { current: string | null | undefined },
  next: string | null,
  queryClient: QueryClient,
): void {
  const previous = previousRef.current;
  previousRef.current = next;
  if (previous === undefined || previous === null) return;
  if (previous === next) return;
  queryClient.clear();
  void wipeFirstChunkCache();
}

export function FrappProvider({ children }: { children: React.ReactNode }) {
  // The token's `active_chapter_id` claim seeds and corrects the store, so a
  // member arriving on a fresh browser is already in their chapter — see the
  // hook for why the store follows the claim and not the other way round.
  useClaimChapterSync();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const authUserId = useAuthUserId();
  const queryClient = useQueryClient();
  const previousChapterId = useRef<string | null | undefined>(undefined);
  const previousAuthUserId = useRef<string | null | undefined>(undefined);

  const client = useMemo(
    () =>
      createFrappClient({
        // Bare origin — the generated SDK paths already carry `/v1`.
        baseUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
        getAuthToken: async () => {
          const supabase = createSupabaseBrowserClient();
          const { data } = await supabase.auth.getSession();
          return data.session?.access_token ?? null;
        },
        getChapterId: () => activeChapterId,
      }),
    [activeChapterId],
  );

  /*
   * Drop every cached query when the active chapter changes.
   *
   * Only about half the chapter-scoped query keys carry the chapter id —
   * ["members", chapterId] does, ["channels"] and ["documents", folder] do not
   * — so without this the unscoped ones keep serving the outgoing chapter's
   * rows under the incoming chapter's context. (Tasks used to be on that list;
   * #560 moved them onto the chapter-scoped `taskKeys` factory in
   * `packages/hooks/src/use-tasks.ts`, because mobile has no equivalent clear
   * and the bleed was real there.)
   * Dropping wholesale rather than enumerating keys is deliberate: that
   * enumeration is exactly the list that is already incomplete, and a chapter
   * switch invalidates the whole view of the app anyway.
   *
   * This has to live in an effect here, not in `useSelectChapter`. Clearing
   * inside that callback races the provider: the clear makes mounted observers
   * refetch, and if that lands before React commits the new chapter id, those
   * refetches go out under the *outgoing* chapter and repopulate the cache we
   * just emptied. An effect runs after commit, so `client` above already
   * carries the new chapter and every refetch the clear triggers is correctly
   * scoped. It also covers any future path that changes chapters, not just the
   * one helper.
   *
   * Skipped when there was no previous chapter (first paint, store rehydration,
   * a first selection from the recovery panel): nothing chapter-scoped can be
   * cached yet, and clearing there would only cancel in-flight bootstrap
   * queries for no benefit.
   */
  useEffect(() => {
    dropCacheWhenIdentityChanges(
      previousChapterId,
      activeChapterId,
      queryClient,
    );
  }, [activeChapterId, queryClient]);

  /*
   * Drop every cached query when the auth uid changes.
   *
   * A same-tab magic-link swap stays authenticated and can keep the same
   * chapter, so the chapter-keyed effect above is a no-op. `["user","me"]` and
   * `["settings"]` are not account-scoped. Subject is the JWT uid
   * (`useAuthUserId`), not `useViewerUserId` — that row is the leftover this
   * clear exists to drop. First uid (`null` → A) is a sign-in, not a swap.
   */
  useEffect(() => {
    dropCacheWhenIdentityChanges(previousAuthUserId, authUserId, queryClient);
  }, [authUserId, queryClient]);

  return (
    <FrappClientProvider client={client} chapterId={activeChapterId}>
      {children}
    </FrappClientProvider>
  );
}
