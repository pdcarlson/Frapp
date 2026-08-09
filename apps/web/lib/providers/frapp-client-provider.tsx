"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useChapterStore } from "@/lib/stores/chapter-store";

export function FrappProvider({ children }: { children: React.ReactNode }) {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const queryClient = useQueryClient();
  const previousChapterId = useRef<string | null | undefined>(undefined);

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
   * ["members", chapterId] does, ["channels"], ["documents", folder] and
   * ["tasks", assigneeId] do not — so without this the unscoped ones keep
   * serving the outgoing chapter's rows under the incoming chapter's context.
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
    const previous = previousChapterId.current;
    previousChapterId.current = activeChapterId;
    if (previous === undefined || previous === null) return;
    if (previous === activeChapterId) return;
    queryClient.clear();
  }, [activeChapterId, queryClient]);

  return (
    <FrappClientProvider client={client} chapterId={activeChapterId}>
      {children}
    </FrappClientProvider>
  );
}
