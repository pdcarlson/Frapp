/**
 * What screens read of chapter presence (#3917): the value the one runtime
 * (`./chapter-presence.ts`, mounted by `AppRuntime`) last produced. Kept apart
 * from the runtime so a screen reading a dot imports no Supabase client or
 * native module, and a second reader costs a store read, not a channel.
 */
import { useMemo, useSyncExternalStore } from "react";
import type { PresenceStatus } from "@repo/hooks/presence-status";
import type { ChapterPresence } from "@repo/hooks/use-chapter-presence";

export const PRESENCE_NOT_READY: ChapterPresence = {
  statusOf: () => "offline",
  lineOf: () => null,
  isReady: false,
};

let current: ChapterPresence = PRESENCE_NOT_READY;
const listeners = new Set<() => void>();

/** The runtime's write. Nothing else calls it. */
export function setChapterPresence(next: ChapterPresence): void {
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** One member's presence as a row draws it: `null` status draws no dot. */
export interface MemberPresence {
  status: PresenceStatus | null;
  line: string | null;
}

export const NO_PRESENCE: MemberPresence = { status: null, line: null };

/**
 * One member's dot and custom status line (#4633), `NO_PRESENCE` until the
 * first sync (or with no member). Each half is read as a primitive through
 * its own selector, so a reader re-renders only when *this* member's status
 * or line changes, not on every heartbeat or another member's re-publish,
 * as reading the whole `ChapterPresence` object would. The object is
 * memoized on those two primitives, so it is stable between their changes.
 */
export function usePresenceOf(
  userId: string | null | undefined,
): MemberPresence {
  const readStatus = () =>
    current.isReady && userId ? current.statusOf(userId) : null;
  const readLine = () =>
    current.isReady && userId ? current.lineOf(userId) : null;
  const status = useSyncExternalStore(subscribe, readStatus, readStatus);
  const line = useSyncExternalStore(subscribe, readLine, readLine);
  return useMemo(
    () => (status === null && line === null ? NO_PRESENCE : { status, line }),
    [status, line],
  );
}
