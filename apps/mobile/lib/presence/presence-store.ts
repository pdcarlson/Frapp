/**
 * What screens read of chapter presence (#3917): the value the one runtime
 * (`./chapter-presence.ts`, mounted by `AppRuntime`) last produced. Kept apart
 * from the runtime so a screen reading a dot imports no Supabase client or
 * native module, and a second reader costs a store read, not a channel.
 */
import { useSyncExternalStore } from "react";
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

function read(): ChapterPresence {
  return current;
}

/**
 * Chapter presence for a screen: `isReady` false (draw no dot, claim no
 * Offline) until the first sync, and whenever the app is signed out,
 * backgrounded or off the link.
 */
export function useChapterPresence(): ChapterPresence {
  return useSyncExternalStore(subscribe, read, read);
}
