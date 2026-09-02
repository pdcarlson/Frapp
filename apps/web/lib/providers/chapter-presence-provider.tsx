"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useChapterPresence } from "@/lib/realtime/use-chapter-presence";
import type { ChapterPresence } from "@/lib/realtime/use-chapter-presence";
import { useActiveChapterId } from "@repo/hooks";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useNetwork } from "@/lib/providers/network-provider";

/**
 * Chapter-wide presence, owned once for the whole dashboard.
 *
 * **Why a provider and not a hook in the screen that needs it.** Two things
 * force it, and the first is a correctness bug rather than a preference:
 *
 *   1. *Presence must outlive the screen that reads it.* If the tracking half
 *      lived in the Directory, a member would be published as present only
 *      while they had `/members` open — so the dot would mean "has the
 *      Directory open", not "is online", and everyone using Chat would render
 *      **Offline**. Offline is a positive claim about a named person, so that
 *      is not a cosmetic gap. Mounted in `DashboardShell`, presence tracks for
 *      as long as the app is open on any dashboard route, which is what
 *      `spec/behavior/chat/README.md` means by "app open".
 *   2. *One topic, one channel.* `attachRealtimeChannel` frees an occupied
 *      topic before minting on it, so a second subscriber on
 *      `presence:chapter:<id>` would tear the first one down — the #783/#817
 *      failure, reached from a new direction. Owning the single subscription
 *      here means extra readers cost a context read, not a channel.
 *
 * This mirrors `useChapterTheme()`, which `DashboardShell` mounts for the same
 * shape of reason: the state is shell-wide, so it must not depend on which
 * route happens to be open.
 */

const ChapterPresenceContext = createContext<ChapterPresence | null>(null);

export function ChapterPresenceProvider({ children }: { children: ReactNode }) {
  const chapterId = useActiveChapterId();
  const { userId: viewerId } = useFrappUser();
  const { isOffline } = useNetwork();

  // Suppressed while the browser reports no link: the socket is down, so every
  // member would read Offline — a claim about *them* sourced from a fault on
  // *our* side.
  const presence = useChapterPresence({
    chapterId,
    viewerId,
    enabled: !isOffline,
  });

  return (
    <ChapterPresenceContext.Provider value={presence}>
      {children}
    </ChapterPresenceContext.Provider>
  );
}

/**
 * Read chapter presence.
 *
 * Returns a permanently-empty, never-ready value outside the provider rather
 * than throwing. A surface rendered without the shell (a test harness, a future
 * route outside `(dashboard)`) should degrade to showing no dots — the same
 * thing it shows before the first sync — instead of taking the screen down over
 * a decoration.
 */
const NOT_PROVIDED: ChapterPresence = {
  statusOf: () => "offline",
  isReady: false,
};

export function useChapterPresenceContext(): ChapterPresence {
  return useContext(ChapterPresenceContext) ?? NOT_PROVIDED;
}
