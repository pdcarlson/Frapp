"use client";

import { useSyncExternalStore } from "react";
import {
  CHAT_CHANNEL_DENSITY_STORAGE_KEY,
  CHAT_DENSITY_STORAGE_KEY,
  DEFAULT_CHAT_DENSITY,
  parseChannelDensityMap,
  parseChatDensity,
  resolveChannelDensity,
  withChannelDensity,
  type ChannelDensityMap,
  type ChatDensity,
} from "@repo/chat-core/density";

/**
 * The member's chat density on this browser (`@repo/chat-core/density`).
 *
 * localStorage, best-effort: a private window or blocked site data throws or
 * reads empty, and the thread draws cozy. One module-level listener set, so
 * the Profile control and every mounted row move together; the `storage`
 * event carries a change made in another tab.
 */
const listeners = new Set<() => void>();

function read(): ChatDensity {
  if (typeof window === "undefined") return DEFAULT_CHAT_DENSITY;
  try {
    return parseChatDensity(
      window.localStorage.getItem(CHAT_DENSITY_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_CHAT_DENSITY;
  }
}

/*
  The snapshot is cached rather than re-read on every `getSnapshot`: React
  calls it on each render of every subscribed row, and a virtualized thread
  renders a lot of rows.
*/
let snapshot: ChatDensity | null = null;

function getSnapshot(): ChatDensity {
  if (snapshot === null) snapshot = read();
  return snapshot;
}

function getServerSnapshot(): ChatDensity {
  return DEFAULT_CHAT_DENSITY;
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (
    event.key !== null &&
    event.key !== CHAT_DENSITY_STORAGE_KEY &&
    event.key !== CHAT_CHANNEL_DENSITY_STORAGE_KEY
  ) {
    return;
  }
  snapshot = read();
  channelSnapshot = readChannels();
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/*
  Per-channel overrides (#3787), a map of channel id to density on this
  browser, read and cached like the default. A channel with no entry follows
  the default.
*/
const NO_OVERRIDES: ChannelDensityMap = {};
let channelSnapshot: ChannelDensityMap | null = null;

function readChannels(): ChannelDensityMap {
  if (typeof window === "undefined") return NO_OVERRIDES;
  try {
    return parseChannelDensityMap(
      window.localStorage.getItem(CHAT_CHANNEL_DENSITY_STORAGE_KEY),
    );
  } catch {
    return NO_OVERRIDES;
  }
}

function getChannelSnapshot(): ChannelDensityMap {
  if (channelSnapshot === null) channelSnapshot = readChannels();
  return channelSnapshot;
}

function getServerChannelSnapshot(): ChannelDensityMap {
  return NO_OVERRIDES;
}

/**
 * The member's default density on this browser, or, given a channel, what
 * that channel draws: its override if the member set one, else the default.
 */
export function useChatDensity(channelId?: string | null): ChatDensity {
  const fallback = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const overrides = useSyncExternalStore(
    subscribe,
    getChannelSnapshot,
    getServerChannelSnapshot,
  );
  return resolveChannelDensity(fallback, overrides, channelId);
}

/** The channel's own override on this browser, or `null` when it follows the default. */
export function useChannelDensityOverride(
  channelId: string | null | undefined,
): ChatDensity | null {
  const overrides = useSyncExternalStore(
    subscribe,
    getChannelSnapshot,
    getServerChannelSnapshot,
  );
  return (channelId ? overrides[channelId] : undefined) ?? null;
}

/** Pins a channel to a density on this browser, or back to the default with `null`. */
export function setChannelDensity(
  channelId: string,
  density: ChatDensity | null,
): void {
  channelSnapshot = withChannelDensity(
    getChannelSnapshot(),
    channelId,
    density,
  );
  try {
    window.localStorage.setItem(
      CHAT_CHANNEL_DENSITY_STORAGE_KEY,
      JSON.stringify(channelSnapshot),
    );
  } catch {
    /* Best-effort, as the default is. */
  }
  notify();
}

export function setChatDensity(density: ChatDensity): void {
  snapshot = density;
  try {
    window.localStorage.setItem(CHAT_DENSITY_STORAGE_KEY, density);
  } catch {
    /* Best-effort: the choice holds for this page's life. */
  }
  notify();
}

/** Test seam: forget the cached read so a spec can seed storage first. */
export function resetChatDensityForTests(): void {
  snapshot = null;
  channelSnapshot = null;
}
